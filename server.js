
const express=require("express");
const cors=require("cors");
const fs=require("fs");
const path=require("path");
const bcrypt=require("bcryptjs");
const jwt=require("jsonwebtoken");
const multer=require("multer");
const crypto=require("crypto");
const helmet=require("helmet");
const rateLimit=require("express-rate-limit");

const isProduction=process.env.NODE_ENV==="production";
const app=express();
if(isProduction) app.set("trust proxy",1);
app.disable("x-powered-by");

const configuredOrigins=String(process.env.CORS_ORIGINS||"").split(",").map(x=>x.trim()).filter(Boolean);
// This app is normally served from the same origin, so CORS is not needed unless
// the operator explicitly configures additional trusted frontend origins.
// Previously an empty CORS_ORIGINS caused every browser POST to be rejected with
// a server-side CORS error, which surfaced to users as "Internal server error".
if(configuredOrigins.length){
  app.use(cors({
    origin:(origin,cb)=>{
      if(!origin) return cb(null, true);
      return cb(null, configuredOrigins.includes(origin));
    },
    methods:["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
    allowedHeaders:["Content-Type","Authorization"],
    credentials:false
  }));
}
// Keep CSP disabled because this project currently uses inline scripts, while still enabling
// Helmet's other useful security headers (frameguard, noSniff, HSTS when HTTPS is used, etc.).
app.use(helmet({contentSecurityPolicy:false, crossOriginEmbedderPolicy:false}));
app.use(express.json({limit:"1mb"}));
app.use(express.urlencoded({extended:false,limit:"1mb"}));

const ipKey=req=>req.ip||req.headers["x-forwarded-for"]||"unknown";
const authLimiter=rateLimit({windowMs:15*60*1000,max:20,standardHeaders:true,legacyHeaders:false,skipSuccessfulRequests:false,message:{message:"Too many authentication attempts. Please try again later."}});
const otpLimiter=rateLimit({windowMs:15*60*1000,max:5,standardHeaders:true,legacyHeaders:false,keyGenerator:ipKey,message:{message:"Too many OTP requests. Please try again later."}});
const adminLoginLimiter=rateLimit({windowMs:15*60*1000,max:8,standardHeaders:true,legacyHeaders:false,keyGenerator:ipKey,message:{message:"Too many admin login attempts. Please try again later."}});


const PORT=process.env.PORT||3000;
const JWT_SECRET=process.env.JWT_SECRET||"";
if(isProduction && JWT_SECRET.length<32){
  throw new Error("JWT_SECRET must be set to a random value of at least 32 characters in production.");
}
if(!JWT_SECRET){ console.warn("WARNING: JWT_SECRET is not set. A temporary random secret will be used for this process only."); }
const EFFECTIVE_JWT_SECRET=JWT_SECRET||crypto.randomBytes(48).toString("hex");
const ADMIN_MOBILE=process.env.ADMIN_MOBILE||"01700000000";
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||"ChangeMe123!";
if(isProduction && !process.env.ADMIN_PASSWORD){ throw new Error("ADMIN_PASSWORD must be set in production."); }
const SMS_WEBHOOK_URL=process.env.SMS_WEBHOOK_URL||"";
const OTP_TTL_MS=5*60*1000;

const ROOT=__dirname, DATA_DIR=path.join(ROOT,"data"), UPLOAD_DIR=path.join(ROOT,"uploads");
fs.mkdirSync(DATA_DIR,{recursive:true}); fs.mkdirSync(UPLOAD_DIR,{recursive:true});
try{fs.chmodSync(DATA_DIR,0o700);}catch{}
const DB_FILE=path.join(DATA_DIR,"database.json");
const LEGACY_DB_FILE=path.join(ROOT,"database.json");
if(!fs.existsSync(DB_FILE)){
  if(fs.existsSync(LEGACY_DB_FILE)) { fs.copyFileSync(LEGACY_DB_FILE,DB_FILE); try{fs.chmodSync(DB_FILE,0o600);}catch{} }
  else fs.writeFileSync(DB_FILE,JSON.stringify({},null,2),{mode:0o600});
}

function defaultSiteConfig(){return {features:{registration:true,login:true,deposit:true,withdraw:true,matches:true,referral:true,support:true,winning:true,announcement:true,download_app:true},home:{hero_title:"Ludo Income",hero_text:"Play · Win · Earn",show_announcement:true,show_matches:true,show_quick_buttons:true,quick_buttons:[{id:"deposit",label:"Deposit",icon:"💳",action:"page:deposit",enabled:true,sort_order:0},{id:"withdraw",label:"Withdraw",icon:"💸",action:"page:withdraw",enabled:true,sort_order:1},{id:"matches",label:"Tournament",icon:"🏆",action:"page:matches",enabled:true,sort_order:2},{id:"mymatches",label:"My Match",icon:"🎉",action:"page:mymatches",enabled:true,sort_order:3}],buttons:[],sections:[]}}}


function readDB(){
  const db=JSON.parse(fs.readFileSync(DB_FILE,"utf8"));
  db.site_config ||= defaultSiteConfig();
  db.site_config.features ||= defaultSiteConfig().features;
  db.site_config.home ||= defaultSiteConfig().home;
  db.site_config.home.buttons ||= [];
  db.site_config.home.quick_buttons ||= defaultSiteConfig().home.quick_buttons;
  db.site_config.home.quick_buttons=db.site_config.home.quick_buttons.map((x,i)=>({...x,id:String(x.id||("quick_"+i)),label:String(x.label||"Button"),icon:String(x.icon||"🔘"),action:String(x.action||""),enabled:x.enabled!==false,sort_order:Number.isFinite(Number(x.sort_order))?Number(x.sort_order):i})).sort((a,b)=>a.sort_order-b.sort_order);
  db.site_config.home.sections ||= [];
  if(!db.payment_settings) db.payment_settings={
    bkash:{number:"01301470686",label:"Personal",enabled:true,logo_url:""},
    nagad:{number:"01806097369",label:"Personal",enabled:true,logo_url:""},
    min_deposit:10,
    instructions:[
      "কমপক্ষে ১০ টাকা ডিপোজিট করা যাবে।",
      "টাকা পাঠানোর পর bKash/Nagad Statement বা Transaction History থেকে Transaction ID নিন।",
      "Transaction ID অবশ্যই জমা দিতে হবে।",
      "সঠিক Transaction ID না দিলে ডিপোজিট approve হবে না এবং balance-এ টাকা যোগ হবে না।"
    ]
  };
  db.payment_settings.bkash ||= {number:"01301470686",label:"Personal",enabled:true,logo_url:"/payment-logos/bkash-personal.jpg?v=2"};
  db.payment_settings.nagad ||= {number:"01806097369",label:"Personal",enabled:true,logo_url:"/payment-logos/nagad-personal.jpg?v=2"};
  db.payment_settings.bkash_merchant ||= {number:"01301470686",label:"Merchant",enabled:true,logo_url:"/payment-logos/bkash-merchant.jpg?v=2"};
  if(!db.payment_settings.bkash.logo_url) db.payment_settings.bkash.logo_url="/payment-logos/bkash-personal.jpg?v=2";
  if(!db.payment_settings.nagad.logo_url) db.payment_settings.nagad.logo_url="/payment-logos/nagad-personal.jpg?v=2";
  if(!db.payment_settings.bkash_merchant.logo_url) db.payment_settings.bkash_merchant.logo_url="/payment-logos/bkash-merchant.jpg?v=2";
  db.payment_settings.min_deposit=Number(db.payment_settings.min_deposit)||10;
  if(!Array.isArray(db.payment_settings.instructions)) db.payment_settings.instructions=[];
  if(!Array.isArray(db.payment_settings.methods)) db.payment_settings.methods=Object.keys(db.payment_settings).filter(k=>!['min_deposit','instructions','methods'].includes(k)).map((k,i)=>({id:k,name:k,label:db.payment_settings[k]?.label||'Payment',number:db.payment_settings[k]?.number||'',logo_url:db.payment_settings[k]?.logo_url||'',enabled:db.payment_settings[k]?.enabled!==false,sort_order:i}));
  db.payment_settings.methods=db.payment_settings.methods.map((m,i)=>({...m,id:String(m.id||('method_'+Date.now()+'_'+i)),name:String(m.name||'Payment'),label:String(m.label||''),number:String(m.number||''),logo_url:String(m.logo_url||''),enabled:m.enabled!==false,sort_order:Number.isFinite(Number(m.sort_order))?Number(m.sort_order):i})).sort((a,b)=>a.sort_order-b.sort_order);
  db.profile_settings ||= {};
  const ps=db.profile_settings;
  if(ps.uid_prefix===undefined) ps.uid_prefix="LI";
  if(ps.profile_logo===undefined) ps.profile_logo="👨‍🦱";
  ["show_name","show_mobile","show_uid","show_matches","show_referral"].forEach(k=>{if(ps[k]===undefined) ps[k]=true;});
  ps.uid_label=ps.uid_label||"UID Code";
  ps.mobile_label=ps.mobile_label||"Mobile Number";
  ps.matches_label=ps.matches_label||"🎮 Matches";
  ps.statement_label=ps.statement_label||"📒 My Statement";
  db.match_settings ||= {};
  const ms=db.match_settings;
  ms.players_to_close=Math.max(2,Number(ms.players_to_close)||2);
  if(ms.show_room_after_full===undefined) ms.show_room_after_full=true;
  ms.my_match_label=ms.my_match_label||"🎉 My Match 🎉";
  ms.upload_label=ms.upload_label||"📸 Upload Winning Screenshot";
  ms.success_message=ms.success_message||"Screenshot submitted successfully!";
  if(ms.one_screenshot_per_match===undefined) ms.one_screenshot_per_match=true;
  db.maintenance ||= {};
  const mt=db.maintenance;
  if(mt.enabled===undefined) mt.enabled=false;
  mt.title=mt.title||"🔧 Update চলছে";
  mt.message=mt.message||"আমাদের Ludo Income App বর্তমানে আপডেট করা হচ্ছে। Update শেষ হলে আবার প্রবেশ করতে পারবেন।";
  mt.footer=mt.footer||"এতক্ষণ আমাদের সাথে থাকার জন্য ধন্যবাদ ❤️";
  mt.button_text=mt.button_text||"🔄 আবার চেষ্টা করুন";
  return db
}
function writeDB(db){
  const tmp=DB_FILE+".tmp";
  fs.writeFileSync(tmp,JSON.stringify(db,null,2),{mode:0o600});
  fs.renameSync(tmp,DB_FILE);
}
function ensureAdminData(db){
  db.audit_logs ||= []; db.activity_logs ||= [];
  db.daily_reports ||= [];
}
function audit(db,req,action,details={}){
  ensureAdminData(db);
  db.audit_logs.push({id:id(db.audit_logs),admin_id:req.user?.id??0,action,path:req.path,method:req.method,details,created_at:new Date().toISOString()});
}
function dateRange(q){
  const from=q.from?new Date(q.from+"T00:00:00"):null, to=q.to?new Date(q.to+"T23:59:59.999"):null;
  return {from:from&&!isNaN(from)?from:null,to:to&&!isNaN(to)?to:null};
}
function inRange(iso,range){const d=new Date(iso);return (!range.from||d>=range.from)&&(!range.to||d<=range.to)}
function id(arr){return arr.length?Math.max(...arr.map(x=>Number(x.id)||0))+1:1}
function token(payload){
  const jti=crypto.randomBytes(24).toString("hex");
  const now=new Date().toISOString();
  return {token:jwt.sign({...payload,jti},EFFECTIVE_JWT_SECRET,{expiresIn:"2h"}),jti,created_at:now};
}
function issueSession(db,payload){
  db.sessions ||= [];
  const t=token(payload);
  db.sessions.push({jti:t.jti,user_id:payload.id,role:payload.role,created_at:t.created_at,last_seen_at:t.created_at});
  // Keep only the newest 20 sessions per account.
  const sessions=db.sessions.filter(s=>s.user_id===payload.id&&s.role===payload.role).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  const keep=new Set(sessions.slice(0,20).map(s=>s.jti));
  db.sessions=db.sessions.filter(s=>s.user_id!==payload.id||s.role!==payload.role||keep.has(s.jti));
  return t.token;
}
function revokeUserSessions(db,userId){db.sessions ||= [];db.sessions=db.sessions.filter(s=>!(s.user_id===userId&&s.role==="user"));}
function revokeAdminSessions(db){db.sessions ||= [];db.sessions=db.sessions.filter(s=>s.role!=="admin");}
function auth(req,res,next){
  try{
    const h=req.headers.authorization||"";
    if(!h.startsWith("Bearer ")) throw new Error();
    const decoded=jwt.verify(h.slice(7),EFFECTIVE_JWT_SECRET);
    const db=readDB();
    const session=(db.sessions||[]).find(s=>s.jti===decoded.jti&&s.user_id===decoded.id&&s.role===decoded.role);
    if(!session) throw new Error();
    if(decoded.role==="user"){
      const u=db.users.find(x=>x.id===decoded.id);
      if(!u || u.blocked) throw new Error();
      if(decoded.pwdv!==String(u.password_changed_at||"")) throw new Error();
    }else if(decoded.role==="admin"){
      const av=String(db.admin_settings?.auth_version||"1");
      if(String(decoded.av||"")!==av) throw new Error();
    }
    session.last_seen_at=new Date().toISOString();
    // Do not persist last_seen on every request; the session itself is still valid via DB presence.
    req.user=decoded; next();
  }catch(e){res.status(401).json({message:"Unauthorized or expired session"})}
}
function admin(req,res,next){auth(req,res,()=>{if(req.user.role!=="admin") return res.status(403).json({message:"Admin only"}); next()})}
function passwordError(password,isAdmin=false){
  const min=isAdmin?10:8;
  if(String(password||"").length<min) return `Password must be at least ${min} characters`;
  if(!/[A-Z]/.test(password)||!/[a-z]/.test(password)||!/[0-9]/.test(password)) return "Password must include uppercase, lowercase and a number";
  return null;
}
function maintenanceEnabled(){ return !!readDB().maintenance?.enabled; }
function maintenancePage(){
 const m=readDB().maintenance||{};
 const safe=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
 return `<!doctype html><html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#16a34a"><title>Ludo Income — Update</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#f0fdf4,#dcfce7);font-family:Arial,"Noto Sans Bengali",sans-serif;color:#111827}.box{width:min(92%,430px);background:#fff;border-radius:24px;padding:34px 24px;text-align:center;box-shadow:0 12px 40px #0002}.icon{font-size:58px}.title{font-size:28px;margin:12px 0}.msg{font-size:17px;line-height:1.7;color:#4b5563}.foot{margin-top:22px;font-weight:700;color:#166534}.btn{margin-top:22px;border:0;border-radius:12px;padding:13px 20px;background:#16a34a;color:#fff;font-weight:700;font-size:16px}</style></head><body><main class="box"><img src="/ludo-income-main-logo.jpg?v=2" alt="Ludo Income Logo" style="width:120px;height:120px;object-fit:contain;border-radius:22px;background:#fff;padding:4px;box-shadow:0 4px 18px #0002"><div class="icon" style="font-size:34px;margin-top:12px">🔧</div><h1 class="title">${safe(m.title)}</h1><div class="msg">${safe(m.message).replace(/\n/g,"<br>")}</div><div class="foot">${safe(m.footer)}</div><button class="btn" onclick="location.reload()">${safe(m.button_text)}</button></main></body></html>`;
}
app.get("/api/maintenance",(req,res)=>res.json({maintenance:readDB().maintenance||{enabled:false}}));
// Maintenance blocks normal users/site while keeping Admin Panel and Admin APIs accessible.
app.use((req,res,next)=>{
 const p=req.path||"";
 if(p==="/api/health" || p==="/api/maintenance" || p==="/admin" || p.startsWith("/api/admin") || p.startsWith("/uploads/")) return next();
 if(!maintenanceEnabled()) return next();
 if(p.startsWith("/api/")) return res.status(503).json({success:false,maintenance:true,message:(readDB().maintenance?.message)||"Update চলছে"});
 return res.status(503).type("html").send(maintenancePage());
});

function getBalance(db,uid){
  let b=db.balances.find(x=>x.user_id===uid);
  if(!b){b={id:id(db.balances),user_id:uid,gaming_balance:0,winning_balance:0};db.balances.push(b);writeDB(db)}
  return b;
}
const upload=multer({storage:multer.diskStorage({
 destination:(req,file,cb)=>cb(null,UPLOAD_DIR),
 filename:(req,file,cb)=>cb(null,Date.now()+"-"+Math.random().toString(36).slice(2)+path.extname(file.originalname).toLowerCase())
}),fileFilter:(req,file,cb)=>{if(!/^image\/(png|jpe?g|webp)$/.test(file.mimetype)) return cb(new Error("Only PNG, JPG or WEBP images are allowed"));cb(null,true)},limits:{fileSize:5*1024*1024}});

app.get("/api/health",(req,res)=>res.json({ok:true,service:"Ludo Income"}));

function makeUid(db){
  const prefix=String(db.profile_settings?.uid_prefix||"LI").replace(/[^A-Za-z0-9]/g,"").slice(0,8)||"LI";
  let code="";
  do { code=prefix+"-"+Math.random().toString(36).slice(2,10).toUpperCase(); } while(db.users.some(u=>u.uid_code===code));
  return code;
}


function normalizeMobile(v){ return String(v||"").replace(/\D/g,""); }
function validMobile(v){ return /^01\d{9}$/.test(String(v||"")); }
async function sendOtp(mobile,otp,purpose){
  if(SMS_WEBHOOK_URL){
    try{
      const r=await fetch(SMS_WEBHOOK_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mobile,otp,purpose})});
      if(!r.ok) throw new Error("SMS provider error");
      return true;
    }catch(e){ console.error("OTP SMS failed:",e.message); return false; }
  }
  console.log(`[LUDO INCOME OTP] ${purpose} -> ${mobile}: ${otp}`);
  return true;
}
function issueOtp(db,mobile,purpose){
  db.otps ||= [];
  const code=String(crypto.randomInt(100000,1000000));
  const now=Date.now();
  db.otps=db.otps.filter(x=>!(x.mobile===mobile&&x.purpose===purpose));
  db.otps.push({id:id(db.otps),mobile,purpose,code_hash:crypto.createHash("sha256").update(code).digest("hex"),expires_at:new Date(now+OTP_TTL_MS).toISOString(),attempts:0,created_at:new Date(now).toISOString()});
  return code;
}
function consumeOtp(db,mobile,purpose,code){
  const row=(db.otps||[]).find(x=>x.mobile===mobile&&x.purpose===purpose);
  if(!row) return {ok:false,message:"OTP not found. Request a new OTP."};
  if(new Date(row.expires_at).getTime()<Date.now()) return {ok:false,message:"OTP expired. Request a new OTP."};
  if((row.attempts||0)>=5) return {ok:false,message:"Too many OTP attempts. Request a new OTP."};
  row.attempts=(row.attempts||0)+1;
  const h=crypto.createHash("sha256").update(String(code||"")).digest("hex");
  if(h!==row.code_hash) return {ok:false,message:"Invalid OTP"};
  db.otps=db.otps.filter(x=>x!==row); return {ok:true};
}
function ensureSecurity(db){
  db.otps ||= [];
  ensureAdminData(db);
  db.admin_settings ||= {};
  if(!db.admin_settings.password_hash){ db.admin_settings.password_hash=bcrypt.hashSync(ADMIN_PASSWORD,12); }
  db.admin_settings.mobile=db.admin_settings.mobile||ADMIN_MOBILE;
  db.admin_settings.auth_version=String(db.admin_settings.auth_version||"1");
  db.sessions ||= [];
  db.withdraw_settings ||= {min_withdraw:50,max_withdraw:50000,fee:0};
  db.withdraw_settings.min_withdraw=Math.max(1,Number(db.withdraw_settings.min_withdraw)||50);
  db.withdraw_settings.max_withdraw=Math.max(db.withdraw_settings.min_withdraw,Number(db.withdraw_settings.max_withdraw)||50000);
  db.withdraw_settings.fee=Math.max(0,Number(db.withdraw_settings.fee)||0);
}

app.post("/api/auth/request-otp",otpLimiter,async(req,res)=>{
 const mobile=normalizeMobile(req.body.mobile),purpose=String(req.body.purpose||"");
 if(!validMobile(mobile)) return res.status(400).json({message:"Valid Bangladesh mobile number required"});
 if(!["register","reset_password","change_mobile"].includes(purpose)) return res.status(400).json({message:"Invalid OTP purpose"});
 const db=readDB();
 const recent=(db.otps||[]).find(x=>x.mobile===mobile&&x.purpose===purpose&&Date.now()-new Date(x.created_at).getTime()<60000);
 if(recent) return res.status(429).json({message:"Please wait 60 seconds before requesting another OTP"});
 if(purpose==="register" && db.users.some(u=>u.mobile===mobile)) return res.status(409).json({message:"Mobile already registered"});
 if(purpose!=="register" && !db.users.some(u=>u.mobile===mobile)) return res.status(404).json({message:"Mobile number not found"});
 const otp=issueOtp(db,mobile,purpose); writeDB(db);
 const sent=await sendOtp(mobile,otp,purpose);
 if(!sent) return res.status(503).json({message:"OTP delivery failed. Please try again."});
 res.json({message:"OTP sent successfully",expires_in:300});
});
app.post("/api/auth/verify-otp",(req,res)=>{
 const mobile=normalizeMobile(req.body.mobile),purpose=String(req.body.purpose||"");
 const db=readDB(),result=consumeOtp(db,mobile,purpose,req.body.otp); writeDB(db);
 if(!result.ok) return res.status(400).json({message:result.message});
 res.json({verified:true});
});
app.post("/api/auth/forgot-password",authLimiter,async(req,res)=>{
 const mobile=normalizeMobile(req.body.mobile),otp=String(req.body.otp||""),password=String(req.body.password||"");
 if(!validMobile(mobile)) return res.status(400).json({message:"Valid Bangladesh mobile number required"});
 const pErr=passwordError(password); if(pErr) return res.status(400).json({message:pErr});
 const db=readDB(),u=db.users.find(x=>x.mobile===mobile); if(!u)return res.status(404).json({message:"Mobile number not found"});
 const result=consumeOtp(db,mobile,"reset_password",otp); if(!result.ok){writeDB(db);return res.status(400).json({message:result.message});}
 u.password=await bcrypt.hash(password,12); u.password_changed_at=new Date().toISOString(); revokeUserSessions(db,u.id); writeDB(db);
 res.json({message:"Password reset successfully"});
});
app.post("/api/user/change-password",auth,async(req,res)=>{
 const current=String(req.body.current_password||""),next=String(req.body.new_password||"");
 const pErr=passwordError(next); if(pErr)return res.status(400).json({message:pErr});
 const db=readDB(),u=db.users.find(x=>x.id===req.user.id); if(!u)return res.status(404).json({message:"User not found"});
 if(!(await bcrypt.compare(current,u.password)))return res.status(400).json({message:"Current password is incorrect"});
 u.password=await bcrypt.hash(next,12);u.password_changed_at=new Date().toISOString();revokeUserSessions(db,u.id);writeDB(db);res.json({message:"Password changed successfully"});
});
app.post("/api/user/request-mobile-change",auth,async(req,res)=>{
 const mobile=normalizeMobile(req.body.mobile); if(!validMobile(mobile))return res.status(400).json({message:"Valid Bangladesh mobile number required"});
 const db=readDB(),u=db.users.find(x=>x.id===req.user.id); if(!u)return res.status(404).json({message:"User not found"});
 if(db.users.some(x=>x.mobile===mobile&&x.id!==u.id))return res.status(409).json({message:"Mobile already registered"});
 const otp=issueOtp(db,mobile,"change_mobile");writeDB(db);const sent=await sendOtp(mobile,otp,"change_mobile");if(!sent)return res.status(503).json({message:"OTP delivery failed"});res.json({message:"OTP sent",expires_in:300});
});
app.post("/api/user/change-mobile",auth,(req,res)=>{
 const mobile=normalizeMobile(req.body.mobile),db=readDB(),u=db.users.find(x=>x.id===req.user.id);if(!u)return res.status(404).json({message:"User not found"});
 if(!validMobile(mobile))return res.status(400).json({message:"Valid Bangladesh mobile number required"});
 if(db.users.some(x=>x.mobile===mobile&&x.id!==u.id))return res.status(409).json({message:"Mobile already registered"});
 const result=consumeOtp(db,mobile,"change_mobile",req.body.otp);if(!result.ok){writeDB(db);return res.status(400).json({message:result.message});}
 u.mobile=mobile;u.mobile_verified=true;u.mobile_changed_at=new Date().toISOString();writeDB(db);res.json({message:"Mobile number changed successfully"});
});

app.post("/api/auth/register",authLimiter,async(req,res)=>{
 try{
  const cfg=readDB();
  if(cfg.site_config?.features?.registration===false)return res.status(403).json({message:"Registration is currently disabled"});
  const name=String(req.body?.name||"").trim();
  const password=String(req.body?.password||"");
  const mobile=normalizeMobile(req.body?.mobile);
  if(!name||!mobile||!password) return res.status(400).json({message:"Name, mobile and password required"});
  if(name.length>80) return res.status(400).json({message:"Name is too long"});
  const pErr=passwordError(password); if(pErr) return res.status(400).json({message:pErr});
  if(!validMobile(mobile)) return res.status(400).json({message:"Valid Bangladesh mobile number required"});
  const db=readDB();
  db.users ||= []; db.balances ||= []; db.sessions ||= [];
  if(db.users.some(u=>u.mobile===mobile)) return res.status(409).json({message:"Mobile already registered"});
  const u={id:id(db.users),name,mobile,password:await bcrypt.hash(password,12),uid_code:makeUid(db),referral_code:"LI"+crypto.randomBytes(4).toString("hex").toUpperCase(),blocked:false,mobile_verified:false,created_at:new Date().toISOString()};
  db.users.push(u);
  db.balances.push({id:id(db.balances),user_id:u.id,gaming_balance:0,winning_balance:0});
  const authToken=issueSession(db,{id:u.id,role:"user",pwdv:String(u.password_changed_at||"")});
  writeDB(db);
  return res.json({token:authToken.token,user:{id:u.id,name:u.name,mobile:u.mobile,uid_code:u.uid_code,referral_code:u.referral_code}});
 }catch(err){
  console.error("Registration failed:",err);
  return res.status(500).json({message:"Registration failed. Please try again."});
 }
});
app.post("/api/auth/login",authLimiter,async(req,res)=>{
 const db=readDB(); if(db.site_config?.features?.login===false)return res.status(403).json({message:"Login is currently disabled"});
 const mobile=normalizeMobile(req.body.mobile),u=db.users.find(x=>x.mobile===mobile);
 if(!u||!(await bcrypt.compare(req.body.password||"",u.password))) return res.status(401).json({message:"Invalid mobile or password"});
 if(u.blocked) return res.status(403).json({message:"Account blocked"});
 const authToken=issueSession(db,{id:u.id,role:"user",pwdv:String(u.password_changed_at||"")}); writeDB(db);
 res.json({token:authToken,user:{id:u.id,name:u.name,mobile:u.mobile,uid_code:u.uid_code,referral_code:u.referral_code}});
});
app.get("/api/user/profile",auth,(req,res)=>{
 const db=readDB(),u=db.users.find(x=>x.id===req.user.id); if(!u)return res.status(404).json({message:"User not found"});
 if(!u.uid_code){u.uid_code=makeUid(db);writeDB(db);}
 const safe={...u}; delete safe.password;
 safe.profile_settings=db.profile_settings;
 safe.match_count=db.match_players.filter(p=>p.user_id===u.id).length;
 res.json({user:safe});
});
app.get("/api/user/balance",auth,(req,res)=>res.json({balance:getBalance(readDB(),req.user.id)}));

app.get("/api/matches",auth,(req,res)=>{
 const db=readDB(); if(db.site_config?.features?.matches===false)return res.json({matches:[]});
 const  threshold=Number(db.match_settings?.players_to_close||2);
 res.json({matches:db.matches.map(m=>{
   const ps=db.match_players.filter(p=>p.match_id===m.id);
   const joined=ps.some(p=>p.user_id===req.user.id);
   const full=ps.length>=threshold;
   return {...m,players:ps.length,full,joined,room_id:(joined&&full&&db.match_settings?.show_room_after_full!==false)?(m.room_id||""):""};
 })});
});
app.get("/api/user/my-matches",auth,(req,res)=>{
 const db=readDB(), threshold=Number(db.match_settings?.players_to_close||2);
 const items=db.match_players.filter(p=>p.user_id===req.user.id).map(p=>{
   const m=db.matches.find(x=>x.id===p.match_id); if(!m)return null;
   const players=db.match_players.filter(x=>x.match_id===m.id).length;
   const full=players>=threshold;
   const submission=db.winnings.find(w=>w.user_id===req.user.id&&w.match_id===m.id);
   return {id:m.id,title:m.title||"Ludo Match",entry_fee:Number(m.entry_fee||0),prize:Number(m.prize||0),time:m.time||"",status:m.status||"upcoming",players,full,room_id:(full&&db.match_settings?.show_room_after_full!==false)?(m.room_id||""):"",joined_at:p.created_at,submission:submission?{id:submission.id,status:submission.status,screenshot:submission.screenshot,created_at:submission.created_at}:null};
 }).filter(Boolean).sort((a,b)=>new Date(b.joined_at)-new Date(a.joined_at));
 res.json({matches:items,settings:db.match_settings});
});
app.post("/api/matches/:id/join",auth,(req,res)=>{
 const db=readDB(); if(db.site_config?.features?.matches===false)return res.status(403).json({message:"Matches are currently disabled"});
 const m=db.matches.find(x=>x.id==req.params.id); if(!m)return res.status(404).json({message:"Match not found"});
 if(String(m.status).toLowerCase()==="full"||String(m.status).toLowerCase()==="completed")return res.status(400).json({message:"Match is closed"});
 if(db.match_players.some(p=>p.match_id==m.id&&p.user_id==req.user.id))return res.status(400).json({message:"Already joined"});
 const threshold=Number(db.match_settings?.players_to_close||2);
 const players=db.match_players.filter(p=>p.match_id==m.id).length;
 if(players>=threshold)return res.status(400).json({message:"Match is full"});
 const b=getBalance(db,req.user.id),fee=Number(m.entry_fee)||0;
 if(Number(b.gaming_balance)<fee)return res.status(400).json({message:"Insufficient gaming balance"});
 b.gaming_balance-=fee;
 db.match_players.push({id:id(db.match_players),match_id:m.id,user_id:req.user.id,created_at:new Date().toISOString()});
 db.transactions.push({id:id(db.transactions),user_id:req.user.id,type:"match_entry",amount:fee,status:"approved",match_id:m.id,created_at:new Date().toISOString()});
 const newCount=players+1;
 if(newCount>=threshold) m.status="full";
 writeDB(db);
 res.json({message:newCount>=threshold?"Match joined. 2 players joined, match is now closed.":"Match joined successfully",full:newCount>=threshold,room_id:(newCount>=threshold&&db.match_settings?.show_room_after_full!==false)?(m.room_id||""):""});
});
app.get("/api/payment-settings",(req,res)=>{
 const s=readDB().payment_settings;
 res.json({payment_settings:s});
});
app.post("/api/deposit",auth,(req,res)=>{
 const db=readDB(); if(db.site_config?.features?.deposit===false)return res.status(403).json({message:"Deposit is currently disabled"});
 const amount=Number(req.body.amount),method=String(req.body.method||"").toLowerCase(),tx=String(req.body.transaction_id||"").trim();
 const s=db.payment_settings;
 const pm=Array.isArray(s.methods)?s.methods.find(x=>String(x.id)===String(method)):null;
 if(!pm || pm.enabled===false) return res.status(400).json({message:"এই payment method এখন বন্ধ আছে"});
 if(!amount||amount<=0) return res.status(400).json({message:"সঠিক amount দিন"});
 if(amount<Number(s.min_deposit||10)) return res.status(400).json({message:"Minimum deposit is ৳"+Number(s.min_deposit||10)});
 if(!tx) return res.status(400).json({message:"Transaction ID অবশ্যই দিতে হবে"});
 const duplicate=db.transactions.some(t=>t.type==="deposit"&&String(t.transaction_id||"").toLowerCase()===tx.toLowerCase());
 if(duplicate) return res.status(400).json({message:"এই Transaction ID আগে জমা দেওয়া হয়েছে"});
 db.transactions.push({id:id(db.transactions),user_id:req.user.id,type:"deposit",method,amount,transaction_id:tx,status:"pending",created_at:new Date().toISOString()});
 writeDB(db);res.json({message:"Deposit submitted for approval"});
});
app.post("/api/withdraw",auth,(req,res)=>{
 const db=readDB(); if(db.site_config?.features?.withdraw===false)return res.status(403).json({message:"Withdraw is currently disabled"}); ensureSecurity(db);const amount=Number(req.body.amount),b=getBalance(db,req.user.id),method=String(req.body.method||"").toLowerCase(),number=normalizeMobile(req.body.number);
 if(!["bkash","nagad"].includes(method))return res.status(400).json({message:"Invalid withdrawal method"});
 if(!validMobile(number))return res.status(400).json({message:"Valid Bangladesh mobile number required"});
 const ws=db.withdraw_settings;
 if(!Number.isFinite(amount)||amount<=0)return res.status(400).json({message:"Invalid amount"});
 if(amount<ws.min_withdraw)return res.status(400).json({message:"Minimum withdraw is ৳"+ws.min_withdraw});
 if(amount>ws.max_withdraw)return res.status(400).json({message:"Maximum withdraw is ৳"+ws.max_withdraw});
 const fee=Number(ws.fee||0),total=amount+fee;
 if(Number(b.winning_balance)<total)return res.status(400).json({message:"Insufficient winning balance including withdrawal fee"});
 if(db.transactions.some(t=>t.type==="withdraw"&&t.user_id===req.user.id&&t.status==="pending"&&Number(t.amount)===amount&&t.number===number))return res.status(409).json({message:"A similar withdrawal is already pending"});
 b.winning_balance-=total;
 db.transactions.push({id:id(db.transactions),user_id:req.user.id,type:"withdraw",method,number,amount,fee,total_debit:total,status:"pending",created_at:new Date().toISOString()});writeDB(db);res.json({message:"Withdraw request submitted",fee,total_debit:total});
});
app.get("/api/transactions",auth,(req,res)=>res.json({transactions:readDB().transactions.filter(x=>x.user_id===req.user.id).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))}));
app.get("/api/user/statement",auth,(req,res)=>{
 const db=readDB(),uid=req.user.id;
 const events=[];
 const userTx=db.transactions.filter(t=>t.user_id===uid);
 userTx.forEach(t=>{
   if(t.type==="deposit") events.push({id:"t"+t.id,type:"deposit",title:"Deposit",amount:Number(t.amount||0),status:t.status,method:t.method,transaction_id:t.transaction_id,created_at:t.created_at});
   else if(t.type==="withdraw") events.push({id:"t"+t.id,type:"withdraw",title:"Withdraw",amount:-Number(t.total_debit??t.amount??0),status:t.status,method:t.method,transaction_id:t.transaction_id,fee:Number(t.fee||0),created_at:t.created_at});
   else if(t.type==="match_refund") { const m=db.matches.find(x=>x.id===t.match_id); events.push({id:"t"+t.id,type:"refund",title:"Match Refund",amount:Number(t.amount||0),status:t.status,match_id:t.match_id,match_title:m?.title||"Ludo Match",created_at:t.created_at}); }
   else if(t.type==="match_entry") { const m=db.matches.find(x=>x.id===t.match_id); events.push({id:"t"+t.id,type:"match_join",title:"Match Joined",amount:-Number(t.amount||0),status:t.status,match_id:t.match_id,match_title:m?.title||"Ludo Match",created_at:t.created_at}); }
   else if(t.type==="match_profit") { const m=db.matches.find(x=>x.id===t.match_id); events.push({id:"t"+t.id,type:"profit",title:"Match Profit",amount:Number(t.amount||0),status:t.status,match_id:t.match_id,match_title:m?.title||"Ludo Match",created_at:t.created_at}); }
 });
 const joined=db.match_players.filter(p=>p.user_id===uid);
 const submittedWins=new Set(db.winnings.filter(w=>w.user_id===uid).map(w=>w.match_id));
 joined.forEach(p=>{const m=db.matches.find(x=>x.id===p.match_id); if(m&&String(m.status).toLowerCase()==="completed"&&!submittedWins.has(p.match_id)&&!userTx.some(t=>t.type==="match_loss"&&t.match_id===p.match_id)){events.push({id:"loss"+p.id,type:"loss",title:"Match Loss",amount:-Number(m.entry_fee||0),status:"completed",match_id:m.id,match_title:m.title||"Ludo Match",created_at:p.created_at});}});
 events.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
 res.json({statement:events,match_count:joined.length,profile_settings:db.profile_settings});
});
app.post("/api/winning",auth,upload.single("screenshot"),(req,res)=>{
 const db=readDB(); if(db.site_config?.features?.winning===false)return res.status(403).json({message:"Winning submission is currently disabled"});
 const matchId=Number(req.body.match_id);
 if(!req.file)return res.status(400).json({message:"Screenshot required"});
 const m=db.matches.find(x=>x.id===matchId); if(!m)return res.status(404).json({message:"Match not found"});
 const joined=db.match_players.some(p=>p.match_id===matchId&&p.user_id===req.user.id); if(!joined)return res.status(403).json({message:"You did not join this match"});
 const threshold=Number(db.match_settings?.players_to_close||2), players=db.match_players.filter(p=>p.match_id===matchId).length;
 if(players<threshold)return res.status(400).json({message:"২ জন player join করার পর screenshot submit করা যাবে"});
 if(db.match_settings?.one_screenshot_per_match!==false && db.winnings.some(w=>w.user_id===req.user.id&&w.match_id===matchId))return res.status(400).json({message:"এই match-এর screenshot একবারই submit করা যাবে"});
 db.winnings.push({id:id(db.winnings),user_id:req.user.id,match_id:matchId,room_id:m.room_id||"",screenshot:"/uploads/"+req.file.filename,status:"pending",created_at:new Date().toISOString()});
 writeDB(db); res.json({success:true,message:db.match_settings?.success_message||"Screenshot submitted successfully!"});
});
app.post("/api/support",auth,(req,res)=>{
 const db=readDB(); if(db.site_config?.features?.support===false)return res.status(403).json({message:"Support is currently disabled"}); if(!req.body.message)return res.status(400).json({message:"Message required"});
 db.support_messages.push({id:id(db.support_messages),user_id:req.user.id,message:req.body.message,reply:"",status:"open",created_at:new Date().toISOString()});writeDB(db);res.json({message:"Message sent"});
});

app.post("/api/auth/logout",auth,(req,res)=>{const db=readDB();db.sessions=(db.sessions||[]).filter(s=>s.jti!==req.user.jti);writeDB(db);res.json({message:"Logged out"});});

/* Admin */
app.post("/api/admin/login",adminLoginLimiter,async(req,res)=>{
 const db=readDB();ensureSecurity(db);const mobile=normalizeMobile(req.body.mobile),password=String(req.body.password||"");
 if(mobile!==db.admin_settings.mobile||!(await bcrypt.compare(password,db.admin_settings.password_hash)))return res.status(401).json({message:"Invalid admin credentials"});
 const authToken=issueSession(db,{id:0,role:"admin",av:String(db.admin_settings.auth_version)});writeDB(db);res.json({token:authToken});
});
app.post("/api/admin/change-password",admin,async(req,res)=>{
 const db=readDB();ensureSecurity(db);const current=String(req.body.current_password||""),next=String(req.body.new_password||"");
 const pErr=passwordError(next,true); if(pErr)return res.status(400).json({message:pErr});
 if(!(await bcrypt.compare(current,db.admin_settings.password_hash)))return res.status(400).json({message:"Current admin password is incorrect"});
 db.admin_settings.password_hash=await bcrypt.hash(next,12);db.admin_settings.password_changed_at=new Date().toISOString();db.admin_settings.auth_version=String(Number(db.admin_settings.auth_version||1)+1);revokeAdminSessions(db);writeDB(db);res.json({message:"Admin password changed successfully"});
});
app.get("/api/admin/security",admin,(req,res)=>{const db=readDB();ensureSecurity(db);res.json({mobile:db.admin_settings.mobile,password_changed_at:db.admin_settings.password_changed_at||null,withdraw_settings:db.withdraw_settings});});
app.put("/api/admin/withdraw-settings",admin,(req,res)=>{const db=readDB();ensureSecurity(db);const b=req.body||{},w=db.withdraw_settings; if(b.min_withdraw!==undefined)w.min_withdraw=Math.max(1,Number(b.min_withdraw)||1);if(b.max_withdraw!==undefined)w.max_withdraw=Math.max(w.min_withdraw,Number(b.max_withdraw)||w.min_withdraw);if(b.fee!==undefined)w.fee=Math.max(0,Number(b.fee)||0);writeDB(db);res.json({message:"Withdraw settings saved",withdraw_settings:w});});
app.get("/api/admin/stats",admin,(req,res)=>{
 const db=readDB(),range=dateRange(req.query);
 const tx=db.transactions.filter(t=>inRange(t.created_at,range)), wins=db.winnings.filter(w=>inRange(w.created_at,range));
 const approvedDeposits=tx.filter(x=>x.type==="deposit"&&x.status==="approved").reduce((s,x)=>s+Number(x.amount||0),0);
 const approvedWithdraws=tx.filter(x=>x.type==="withdraw"&&x.status==="approved").reduce((s,x)=>s+Number(x.amount||0),0);
 const fees=tx.filter(x=>x.type==="withdraw"&&x.status==="approved").reduce((s,x)=>s+Number(x.fee||0),0);
 const entries=tx.filter(x=>x.type==="match_entry"&&x.status==="approved").reduce((s,x)=>s+Number(x.amount||0),0);
 const prizes=tx.filter(x=>x.type==="match_profit"&&x.status==="approved").reduce((s,x)=>s+Number(x.amount||0),0);
 const refunds=tx.filter(x=>x.type==="match_refund"&&x.status==="approved").reduce((s,x)=>s+Number(x.amount||0),0);
 res.json({
  users:db.users.length, active_users:db.users.filter(u=>!u.blocked).length, blocked_users:db.users.filter(u=>u.blocked).length,
  gaming_balance:db.balances.reduce((s,b)=>s+Number(b.gaming_balance||0),0), winning_balance:db.balances.reduce((s,b)=>s+Number(b.winning_balance||0),0),
  pending_requests:db.transactions.filter(x=>x.status==="pending").length+db.winnings.filter(x=>x.status==="pending").length,
  approved_deposits:approvedDeposits,approved_withdraws:approvedWithdraws,withdraw_fees:fees,match_entries:entries,match_prizes:prizes,match_refunds:refunds,net_match_revenue:entries-prizes-refunds,
  matches_total:db.matches.length,matches_completed:db.matches.filter(m=>m.status==="completed").length,matches_cancelled:db.matches.filter(m=>m.status==="cancelled").length,
  daily: Array.from({length:7},(_,i)=>{const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-(6-i));const key=d.toISOString().slice(0,10);const z=tx.filter(t=>String(t.created_at).slice(0,10)===key);return {date:key,users:db.users.filter(u=>String(u.created_at).slice(0,10)===key).length,deposits:z.filter(t=>t.type==="deposit"&&t.status==="approved").reduce((a,t)=>a+Number(t.amount||0),0),withdraws:z.filter(t=>t.type==="withdraw"&&t.status==="approved").reduce((a,t)=>a+Number(t.amount||0),0),entries:z.filter(t=>t.type==="match_entry").reduce((a,t)=>a+Number(t.amount||0),0),prizes:z.filter(t=>t.type==="match_profit").reduce((a,t)=>a+Number(t.amount||0),0)}})
 });
});
app.get("/api/admin/users/:id/profile",admin,(req,res)=>{const db=readDB(),u=db.users.find(x=>x.id==req.params.id);if(!u)return res.status(404).json({message:"User not found"});const b=getBalance(db,u.id);res.json({user:{id:u.id,name:u.name,mobile:u.mobile,uid_code:u.uid_code||"",referral_code:u.referral_code||"",created_at:u.created_at,blocked:!!u.blocked},balance:b,matches:db.match_players.filter(p=>p.user_id===u.id).map(p=>{const m=db.matches.find(x=>x.id===p.match_id);return {match_id:p.match_id,title:m?.title||"Ludo Match",entry_fee:Number(m?.entry_fee||0),status:m?.status||"",joined_at:p.created_at}})});});
app.get("/api/admin/users",admin,(req,res)=>{
 const db=readDB(),q=String(req.query.search||"").toLowerCase(),status=String(req.query.status||"all"),page=Math.max(1,Number(req.query.page)||1),limit=Math.min(100,Math.max(5,Number(req.query.limit)||20));
 let list=db.users.filter(u=>(!q||String(u.name||"").toLowerCase().includes(q)||String(u.mobile||"").includes(q)||String(u.uid_code||"").toLowerCase().includes(q)||String(u.referral_code||"").toLowerCase().includes(q))&&(status==="all"||(status==="blocked"&&u.blocked)||(status==="active"&&!u.blocked)));
 const total=list.length; list=list.slice((page-1)*limit,page*limit);
 res.json({users:list.map(u=>{const b=getBalance(db,u.id);return {id:u.id,name:u.name,mobile:u.mobile,uid_code:u.uid_code||"",referral_code:u.referral_code,blocked:!!u.blocked,matches:db.match_players.filter(p=>p.user_id===u.id).length,gaming_balance:b.gaming_balance,winning_balance:b.winning_balance}}),page,limit,total,pages:Math.ceil(total/limit)});
});
app.post("/api/admin/users/:id/block",admin,(req,res)=>{const db=readDB(),u=db.users.find(x=>x.id==req.params.id);if(!u)return res.status(404).json({message:"User not found"});u.blocked=req.body.blocked!==false;audit(db,req,u.blocked?"user_block":"user_unblock",{user_id:u.id});writeDB(db);res.json({message:"Updated"})});
app.post("/api/admin/users/:id/balance",admin,(req,res)=>{
 const db=readDB(),b=getBalance(db,Number(req.params.id)),g=Number(req.body.gaming_delta||0),w=Number(req.body.winning_delta||0);
 b.gaming_balance+=g;b.winning_balance+=w;db.transactions.push({id:id(db.transactions),user_id:Number(req.params.id),type:"admin_adjustment",gaming_delta:g,winning_delta:w,amount:g+w,status:"approved",created_at:new Date().toISOString()});audit(db,req,"balance_adjust",{user_id:Number(req.params.id),gaming_delta:g,winning_delta:w});writeDB(db);res.json({message:"Balance updated",balance:b});
});
app.get("/api/admin/deposits",admin,(req,res)=>{const db=readDB();res.json({items:db.transactions.filter(x=>x.type==="deposit").map(t=>({...t,user:db.users.find(u=>u.id===t.user_id)?.mobile||"-"}))})});
app.post("/api/admin/deposits/:id/:action",admin,(req,res)=>{
 const db=readDB(),t=db.transactions.find(x=>x.id==req.params.id&&x.type==="deposit");if(!t)return res.status(404).json({message:"Deposit not found"});
 if(t.status!=="pending")return res.status(400).json({message:"Already processed"});
 if(req.params.action==="approve"){t.status="approved";getBalance(db,t.user_id).gaming_balance+=Number(t.amount);audit(db,req,"deposit_approve",{transaction_id:t.id,user_id:t.user_id,amount:t.amount})}
 else if(req.params.action==="reject"){t.status="rejected";audit(db,req,"deposit_reject",{transaction_id:t.id,user_id:t.user_id})}else return res.status(400).json({message:"Invalid action"});
 writeDB(db);res.json({message:"Deposit "+req.params.action});
});
app.get("/api/admin/withdraws",admin,(req,res)=>{const db=readDB();res.json({items:db.transactions.filter(x=>x.type==="withdraw").map(t=>({...t,user:db.users.find(u=>u.id===t.user_id)?.mobile||"-"}))})});
app.post("/api/admin/withdraws/:id/:action",admin,(req,res)=>{
 const db=readDB(),t=db.transactions.find(x=>x.id==req.params.id&&x.type==="withdraw");if(!t)return res.status(404).json({message:"Withdraw not found"});
 if(t.status!=="pending")return res.status(400).json({message:"Already processed"});
 if(req.params.action==="approve"){t.status="approved";audit(db,req,"withdraw_approve",{transaction_id:t.id,user_id:t.user_id,amount:t.amount});}
 else if(req.params.action==="reject"){t.status="rejected";getBalance(db,t.user_id).winning_balance+=Number(t.total_debit??t.amount);audit(db,req,"withdraw_reject_refund",{transaction_id:t.id,user_id:t.user_id,refund:Number(t.total_debit??t.amount)})}
 else return res.status(400).json({message:"Invalid action"});
 writeDB(db);res.json({message:"Withdraw "+req.params.action});
});
app.get("/api/admin/matches",admin,(req,res)=>{
 const db=readDB();
 res.json({matches:db.matches.map(m=>{
  const ps=db.match_players.filter(p=>p.match_id===m.id);
  return {...m,players:ps.length,player_details:ps.map(p=>{
   const u=db.users.find(x=>x.id===p.user_id);
   return {user_id:p.user_id,name:u?.name||"-",uid_code:u?.uid_code||"-",mobile:u?.mobile||"-"};
  })};
 })});
});
app.post("/api/admin/matches",admin,(req,res)=>{
 const db=readDB(),m={id:id(db.matches),title:req.body.title||"Ludo Match",entry_fee:Number(req.body.entry_fee)||0,prize:Number(req.body.prize)||0,max_players:Number(req.body.max_players)||2,time:req.body.time||"",status:req.body.status||"upcoming",room_id:req.body.room_id||"",created_at:new Date().toISOString()};
 db.matches.push(m);audit(db,req,"match_create",{match_id:m.id,title:m.title});writeDB(db);res.json({message:"Match created",match:m});
});
app.put("/api/admin/matches/:id",admin,(req,res)=>{
 const db=readDB(),m=db.matches.find(x=>x.id==req.params.id);if(!m)return res.status(404).json({message:"Match not found"});
 ["title","time","status","room_id"].forEach(k=>{if(req.body[k]!==undefined)m[k]=req.body[k]});
 ["entry_fee","prize","max_players"].forEach(k=>{if(req.body[k]!==undefined)m[k]=Number(req.body[k])});
 audit(db,req,"match_update",{match_id:m.id});writeDB(db);res.json({message:"Match updated"});
});
app.delete("/api/admin/matches/:id",admin,(req,res)=>{const db=readDB(),i=db.matches.findIndex(x=>x.id==req.params.id);if(i<0)return res.status(404).json({message:"Match not found"});const m=db.matches[i];if(m.status!=="completed"&&m.status!=="cancelled"){const players=db.match_players.filter(x=>x.match_id===m.id);players.forEach(p=>{const already=db.transactions.some(t=>t.type==="match_refund"&&t.match_id===m.id&&t.user_id===p.user_id);if(!already){const fee=Number(m.entry_fee||0);getBalance(db,p.user_id).gaming_balance+=fee;db.transactions.push({id:id(db.transactions),user_id:p.user_id,type:"match_refund",amount:fee,status:"approved",match_id:m.id,reason:"admin_delete",created_at:new Date().toISOString()});}})}db.matches.splice(i,1);db.match_players=db.match_players.filter(x=>x.match_id!=req.params.id);audit(db,req,"match_delete",{match_id:m.id});writeDB(db);res.json({message:"Match deleted safely"})});
app.post("/api/admin/matches/:id/result",admin,(req,res)=>{
 const db=readDB(),m=db.matches.find(x=>x.id==req.params.id);if(!m)return res.status(404).json({message:"Match not found"});
 const winnerId=Number(req.body.winner_user_id);if(!winnerId)return res.status(400).json({message:"Winner user required"});
 const joined=db.match_players.filter(p=>p.match_id===m.id);if(!joined.some(p=>p.user_id===winnerId))return res.status(400).json({message:"Winner must be a joined player"});
 if(m.result_locked)return res.status(400).json({message:"Match result already locked"});
 m.status="completed";m.winner_user_id=winnerId;m.result_locked=true;m.completed_at=new Date().toISOString();
 const prize=Number(m.prize||0),existing=db.transactions.some(t=>t.type==="match_profit"&&t.match_id===m.id&&t.user_id===winnerId);
 if(!existing&&prize>0){getBalance(db,winnerId).winning_balance+=prize;db.transactions.push({id:id(db.transactions),user_id:winnerId,type:"match_profit",amount:prize,status:"approved",match_id:m.id,created_at:new Date().toISOString()});}
 audit(db,req,"match_result",{match_id:m.id,winner_user_id:winnerId,prize});writeDB(db);res.json({message:"Match result saved",winner_user_id:winnerId});
});
app.post("/api/admin/matches/:id/cancel",admin,(req,res)=>{
 const db=readDB(),m=db.matches.find(x=>x.id==req.params.id);if(!m)return res.status(404).json({message:"Match not found"});if(m.status==="completed"||m.status==="cancelled")return res.status(400).json({message:"Match already closed"});
 m.status="cancelled";m.cancelled_at=new Date().toISOString();const players=db.match_players.filter(p=>p.match_id===m.id);
 players.forEach(p=>{const refunded=db.transactions.some(t=>t.type==="match_refund"&&t.match_id===m.id&&t.user_id===p.user_id);if(!refunded){const fee=Number(m.entry_fee||0);getBalance(db,p.user_id).gaming_balance+=fee;db.transactions.push({id:id(db.transactions),user_id:p.user_id,type:"match_refund",amount:fee,status:"approved",match_id:m.id,created_at:new Date().toISOString()});}});
 audit(db,req,"match_cancel_refund",{match_id:m.id,players:players.length});writeDB(db);res.json({message:"Match cancelled and players refunded"});
});
app.get("/api/admin/reports",admin,(req,res)=>{
 const db=readDB(),r=dateRange(req.query),tx=db.transactions.filter(t=>inRange(t.created_at,r)),matches=db.matches.filter(m=>inRange(m.created_at,r));
 const by=(type,status)=>tx.filter(t=>t.type===type&&(!status||t.status===status)).reduce((s,t)=>s+Number(t.amount||0),0);
 res.json({from:req.query.from||null,to:req.query.to||null,summary:{approved_deposits:by("deposit","approved"),pending_deposits:by("deposit","pending"),approved_withdraws:by("withdraw","approved"),pending_withdraws:by("withdraw","pending"),withdraw_fees:tx.filter(t=>t.type==="withdraw"&&t.status==="approved").reduce((s,t)=>s+Number(t.fee||0),0),match_entries:by("match_entry","approved"),match_prizes:by("match_profit","approved"),match_refunds:by("match_refund","approved"),matches:matches.length},transactions:tx.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,500)});
});
app.get("/api/admin/transactions",admin,(req,res)=>{
 const db=readDB(),r=dateRange(req.query),q=String(req.query.search||"").toLowerCase(),type=String(req.query.type||"all"),status=String(req.query.status||"all");
 const items=db.transactions.filter(t=>inRange(t.created_at,r)&&(type==="all"||t.type===type)&&(status==="all"||t.status===status)).filter(t=>{const u=db.users.find(x=>x.id===t.user_id);return !q||String(u?.name||"").toLowerCase().includes(q)||String(u?.mobile||"").includes(q)||String(t.transaction_id||"").toLowerCase().includes(q)}).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,1000).map(t=>({...t,user_name:db.users.find(u=>u.id===t.user_id)?.name||"-",user_mobile:db.users.find(u=>u.id===t.user_id)?.mobile||"-"}));
 res.json({items});
});
app.get("/api/admin/audit-logs",admin,(req,res)=>{const db=readDB(),r=dateRange(req.query),q=String(req.query.search||"").toLowerCase();res.json({items:(db.audit_logs||[]).filter(x=>inRange(x.created_at,r)&&(!q||String(x.action).toLowerCase().includes(q)||String(x.path).toLowerCase().includes(q))).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,500)});});
app.get("/api/admin/export",admin,(req,res)=>{const db=readDB(),r=dateRange(req.query),kind=String(req.query.kind||"transactions");let rows=[];if(kind==="users")rows=db.users.map(u=>({id:u.id,name:u.name,mobile:u.mobile,uid:u.uid_code,referral:u.referral_code,blocked:!!u.blocked,created_at:u.created_at}));else if(kind==="matches")rows=db.matches.map(m=>({id:m.id,title:m.title,entry_fee:m.entry_fee,prize:m.prize,max_players:m.max_players,status:m.status,winner_user_id:m.winner_user_id||"",created_at:m.created_at}));else rows=db.transactions.filter(t=>inRange(t.created_at,r)).map(t=>({id:t.id,user_id:t.user_id,type:t.type,amount:t.amount,status:t.status,method:t.method||"",transaction_id:t.transaction_id||"",created_at:t.created_at}));const escv=v=>`"${String(v??"").replace(/"/g,'""')}"`;const keys=rows.length?Object.keys(rows[0]):[];const csv=[keys.join(","),...rows.map(x=>keys.map(k=>escv(x[k])).join(","))].join("\n");res.setHeader("Content-Type","text/csv; charset=utf-8");res.setHeader("Content-Disposition",`attachment; filename=ludo-income-${kind}.csv`);res.send("\ufeff"+csv);});
app.get("/api/admin/winnings",admin,(req,res)=>{const db=readDB();res.json({items:db.winnings.map(w=>({...w,user:db.users.find(u=>u.id===w.user_id)?.mobile||"-"}))})});
app.post("/api/admin/winnings/:id/:action",admin,(req,res)=>{
 const db=readDB(),w=db.winnings.find(x=>x.id==req.params.id);if(!w)return res.status(404).json({message:"Winning not found"});
 if(w.status!=="pending")return res.status(400).json({message:"Already processed"});
 if(req.params.action==="approve"){w.status="approved";const m=db.matches.find(x=>x.id===w.match_id);if(m){const prize=Number(m.prize||0);getBalance(db,w.user_id).winning_balance+=prize;db.transactions.push({id:id(db.transactions),user_id:w.user_id,type:"match_profit",amount:prize,status:"approved",match_id:w.match_id,created_at:new Date().toISOString()});}}
 else if(req.params.action==="reject")w.status="rejected";else return res.status(400).json({message:"Invalid action"});
 audit(db,req,"winning_"+req.params.action,{winning_id:w.id,user_id:w.user_id,match_id:w.match_id});writeDB(db);res.json({message:"Winning "+req.params.action});
});
app.get("/api/admin/support",admin,(req,res)=>{const db=readDB();res.json({items:db.support_messages.map(s=>({...s,user:db.users.find(u=>u.id===s.user_id)?.mobile||"-"}))})});
app.post("/api/admin/support/:id/reply",admin,(req,res)=>{const db=readDB(),s=db.support_messages.find(x=>x.id==req.params.id);if(!s)return res.status(404).json({message:"Message not found"});s.reply=req.body.reply||"";s.status="replied";writeDB(db);res.json({message:"Reply saved"})});
app.get("/api/site-config",(req,res)=>{const s=readDB().site_config||{};res.json({features:s.features||{},home:s.home||{}})});
app.get("/api/admin/site-config",admin,(req,res)=>res.json({site_config:readDB().site_config||{}}));
app.put("/api/admin/site-config",admin,(req,res)=>{const db=readDB(),b=req.body||{},cur=db.site_config||{};cur.features ||= {};cur.home ||= {};cur.home.buttons ||= [];cur.home.sections ||= [];if(b.features&&typeof b.features==='object'){cur.features={...(cur.features||{})};for(const k of Object.keys(cur.features)){if(b.features[k]!==undefined)cur.features[k]=!!b.features[k]};for(const [k,v] of Object.entries(b.features)){if(cur.features[k]===undefined)cur.features[k]=!!v}}if(b.home&&typeof b.home==='object'){cur.home={...(cur.home||{})};for(const k of ['hero_title','hero_text'])if(b.home[k]!==undefined)cur.home[k]=String(b.home[k]).slice(0,200);for(const k of ['show_announcement','show_matches','show_quick_buttons'])if(b.home[k]!==undefined)cur.home[k]=!!b.home[k];}db.site_config=cur;audit(db,req,'site_config_update',{features:cur.features,home:cur.home});writeDB(db);res.json({message:'Site configuration saved',site_config:cur})});
app.put("/api/admin/quick-buttons/:id",admin,(req,res)=>{const db=readDB(),h=db.site_config.home,q=(h.quick_buttons||[]).find(x=>String(x.id)===String(req.params.id));if(!q)return res.status(404).json({message:"Quick button not found"});for(const k of ["label","icon","action"])if(req.body[k]!==undefined)q[k]=String(req.body[k]).trim().slice(0,k==="label"?60:k==="icon"?12:200);if(req.body.enabled!==undefined)q.enabled=!!req.body.enabled;audit(db,req,"quick_button_update",{id:q.id});writeDB(db);res.json({message:"Quick button updated",site_config:db.site_config})});
app.put("/api/admin/quick-buttons-reorder",admin,(req,res)=>{const db=readDB(),h=db.site_config.home,ids=Array.isArray(req.body?.ids)?req.body.ids.map(String):[],map=new Map((h.quick_buttons||[]).map(x=>[String(x.id),x])),a=ids.map(id=>map.get(id)).filter(Boolean);(h.quick_buttons||[]).filter(x=>!ids.includes(String(x.id))).forEach(x=>a.push(x));h.quick_buttons=a.map((x,i)=>({...x,sort_order:i}));audit(db,req,"quick_button_reorder",{ids:a.map(x=>x.id)});writeDB(db);res.json({message:"Quick button order saved",site_config:db.site_config})});
app.post("/api/admin/site-buttons",admin,(req,res)=>{const db=readDB(),h=db.site_config.home,b=req.body||{};if(!String(b.label||'').trim())return res.status(400).json({message:'Button label is required'});const x={id:'btn_'+Date.now()+'_'+crypto.randomBytes(3).toString('hex'),label:String(b.label).trim().slice(0,60),icon:String(b.icon||'🔘').slice(0,12),action:String(b.action||'').trim().slice(0,200),description:String(b.description||'').trim().slice(0,160),enabled:b.enabled!==false,sort_order:h.buttons.length};h.buttons.push(x);h.buttons.forEach((v,i)=>v.sort_order=i);audit(db,req,'site_button_create',{id:x.id,label:x.label});writeDB(db);res.json({message:'Button created',button:x,site_config:db.site_config})});
app.put("/api/admin/site-buttons/:id",admin,(req,res)=>{const db=readDB(),h=db.site_config.home,x=h.buttons.find(v=>String(v.id)===String(req.params.id));if(!x)return res.status(404).json({message:'Button not found'});for(const k of ['label','icon','action','description'])if(req.body[k]!==undefined)x[k]=String(req.body[k]).trim().slice(0,k==='label'?60:k==='icon'?12:k==='description'?160:200);if(req.body.enabled!==undefined)x.enabled=!!req.body.enabled;h.buttons.sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)).forEach((v,i)=>v.sort_order=i);audit(db,req,'site_button_update',{id:x.id});writeDB(db);res.json({message:'Button updated',site_config:db.site_config})});
app.delete("/api/admin/site-buttons/:id",admin,(req,res)=>{const db=readDB(),h=db.site_config.home;h.buttons=h.buttons.filter(v=>String(v.id)!==String(req.params.id)).map((v,i)=>({...v,sort_order:i}));audit(db,req,'site_button_delete',{id:req.params.id});writeDB(db);res.json({message:'Button deleted',site_config:db.site_config})});
app.put("/api/admin/site-buttons-reorder",admin,(req,res)=>{const db=readDB(),h=db.site_config.home,ids=Array.isArray(req.body?.ids)?req.body.ids.map(String):[];const map=new Map(h.buttons.map(x=>[String(x.id),x]));const a=ids.map(id=>map.get(id)).filter(Boolean);h.buttons.filter(x=>!ids.includes(String(x.id))).forEach(x=>a.push(x));h.buttons=a.map((x,i)=>({...x,sort_order:i}));audit(db,req,'site_button_reorder',{ids:a.map(x=>x.id)});writeDB(db);res.json({message:'Button order saved',site_config:db.site_config})});
app.post("/api/admin/site-sections",admin,(req,res)=>{const db=readDB(),h=db.site_config.home,b=req.body||{};if(!String(b.title||'').trim())return res.status(400).json({message:'Section title is required'});const x={id:'sec_'+Date.now()+'_'+crypto.randomBytes(3).toString('hex'),title:String(b.title).trim().slice(0,100),text:String(b.text||'').trim().slice(0,500),image_url:String(b.image_url||'').trim().slice(0,500),button_text:String(b.button_text||'').trim().slice(0,60),button_action:String(b.button_action||'').trim().slice(0,200),enabled:b.enabled!==false,sort_order:h.sections.length};h.sections.push(x);h.sections.forEach((v,i)=>v.sort_order=i);audit(db,req,'site_section_create',{id:x.id,title:x.title});writeDB(db);res.json({message:'Section created',section:x,site_config:db.site_config})});
app.put("/api/admin/site-sections/:id",admin,(req,res)=>{const db=readDB(),h=db.site_config.home,x=h.sections.find(v=>String(v.id)===String(req.params.id));if(!x)return res.status(404).json({message:'Section not found'});for(const k of ['title','text','image_url','button_text','button_action'])if(req.body[k]!==undefined)x[k]=String(req.body[k]).trim().slice(0,k==='title'?100:k==='text'?500:k==='button_text'?60:200);if(req.body.enabled!==undefined)x.enabled=!!req.body.enabled;audit(db,req,'site_section_update',{id:x.id});writeDB(db);res.json({message:'Section updated',site_config:db.site_config})});
app.delete("/api/admin/site-sections/:id",admin,(req,res)=>{const db=readDB(),h=db.site_config.home;h.sections=h.sections.filter(v=>String(v.id)!==String(req.params.id)).map((v,i)=>({...v,sort_order:i}));audit(db,req,'site_section_delete',{id:req.params.id});writeDB(db);res.json({message:'Section deleted',site_config:db.site_config})});
app.put("/api/admin/site-sections-reorder",admin,(req,res)=>{const db=readDB(),h=db.site_config,ids=Array.isArray(req.body?.ids)?req.body.ids.map(String):[];const map=new Map(h.sections.map(x=>[String(x.id),x]));const a=ids.map(id=>map.get(id)).filter(Boolean);h.sections.filter(x=>!ids.includes(String(x.id))).forEach(x=>a.push(x));h.sections=a.map((x,i)=>({...x,sort_order:i}));audit(db,req,'site_section_reorder',{ids:a.map(x=>x.id)});writeDB(db);res.json({message:'Section order saved',site_config:db.site_config})});
app.get("/api/admin/payment-settings",admin,(req,res)=>res.json({payment_settings:readDB().payment_settings}));
app.post("/api/admin/payment-methods/upload",admin,upload.single("logo"),(req,res)=>{
  if(!req.file)return res.status(400).json({message:"Logo file required"});
  if(!/^image\/(png|jpe?g|webp)$/.test(req.file.mimetype)){try{fs.unlinkSync(req.file.path)}catch{};return res.status(400).json({message:"Only PNG, JPG or WEBP logos are allowed"});}
  if(req.file.size>1400*1024){try{fs.unlinkSync(req.file.path)}catch{};return res.status(400).json({message:"Logo must be 1.4MB or smaller"});}
  const ext=path.extname(req.file.originalname).toLowerCase()||({"image/png":".png","image/jpeg":".jpg","image/webp":".webp"}[req.file.mimetype]||".img");
  const safeName=`payment-logo-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
  const target=path.join(UPLOAD_DIR,safeName);
  try{fs.renameSync(req.file.path,target);res.json({logo_url:`/uploads/${safeName}`});}
  catch(e){try{fs.unlinkSync(req.file.path)}catch{};res.status(500).json({message:"Could not save logo"});}
});
app.post("/api/admin/payment-methods",admin,(req,res)=>{const db=readDB(),s=db.payment_settings,b=req.body||{};if(!b.name||!String(b.name).trim())return res.status(400).json({message:"Payment name is required"});s.methods ||= []; const base=String(b.id||('pm_'+Date.now()+'_'+crypto.randomBytes(3).toString('hex'))); if(s.methods.some(m=>m.id===base))return res.status(409).json({message:"Payment method ID already exists"});const m={id:base,name:String(b.name).trim().slice(0,60),label:String(b.label||'Payment').trim().slice(0,40),number:String(b.number||'').trim().slice(0,80),logo_url:String(b.logo_url||'').trim(),enabled:b.enabled!==false,sort_order:Number(b.sort_order)||s.methods.length};s.methods.push(m);s.methods.forEach((x,i)=>x.sort_order=i);audit(db,req,'payment_method_create',{id:m.id,name:m.name});writeDB(db);res.json({message:'Payment method created',method:m,payment_settings:s});});
app.put("/api/admin/payment-methods/:id",admin,(req,res)=>{const db=readDB(),s=db.payment_settings,b=req.body||{},m=(s.methods||[]).find(x=>String(x.id)===String(req.params.id));if(!m)return res.status(404).json({message:'Payment method not found'});['name','label','number','logo_url'].forEach(k=>{if(b[k]!==undefined)m[k]=String(b[k]).trim().slice(0,k==='name'?60:k==='label'?40:100)});if(b.enabled!==undefined)m.enabled=!!b.enabled;if(b.sort_order!==undefined)m.sort_order=Math.max(0,Number(b.sort_order)||0);s.methods.sort((a,b)=>a.sort_order-b.sort_order).forEach((x,i)=>x.sort_order=i);audit(db,req,'payment_method_update',{id:m.id,name:m.name});writeDB(db);res.json({message:'Payment method updated',method:m,payment_settings:s});});
app.delete("/api/admin/payment-methods/:id",admin,(req,res)=>{const db=readDB(),s=db.payment_settings||{},before=s.methods||[],m=before.find(x=>String(x.id)===String(req.params.id));if(!m)return res.status(404).json({message:'Payment method not found'});s.methods=before.filter(x=>String(x.id)!==String(req.params.id)).sort((a,b)=>a.sort_order-b.sort_order).map((x,i)=>({...x,sort_order:i}));audit(db,req,'payment_method_delete',{id:m.id,name:m.name});writeDB(db);res.json({message:'Payment method deleted',payment_settings:s});});
app.put("/api/admin/payment-methods-reorder",admin,(req,res)=>{const db=readDB(),s=db.payment_settings||{},ids=Array.isArray(req.body?.ids)?req.body.ids.map(String):[];if(!ids.length)return res.status(400).json({message:'ids required'});const map=new Map((s.methods||[]).map(x=>[String(x.id),x]));const ordered=ids.map(id=>map.get(id)).filter(Boolean);(s.methods||[]).filter(x=>!ids.includes(String(x.id))).forEach(x=>ordered.push(x));s.methods=ordered.map((x,i)=>({...x,sort_order:i}));audit(db,req,'payment_method_reorder',{ids:s.methods.map(x=>x.id)});writeDB(db);res.json({message:'Payment order saved',payment_settings:s});});
app.put("/api/admin/payment-settings",admin,(req,res)=>{const db=readDB(),body=req.body||{},s=db.payment_settings;if(body.min_deposit!==undefined){const n=Number(body.min_deposit);if(!Number.isFinite(n)||n<1)return res.status(400).json({message:"Minimum deposit must be at least 1"});s.min_deposit=n}if(Array.isArray(body.instructions))s.instructions=body.instructions.map(x=>String(x).trim()).filter(Boolean).slice(0,10);writeDB(db);res.json({message:"Payment settings saved",payment_settings:s});});
app.get("/api/admin/match-settings",admin,(req,res)=>res.json({match_settings:readDB().match_settings}));
app.put("/api/admin/match-settings",admin,(req,res)=>{const db=readDB(),b=req.body||{},s=db.match_settings||{};if(b.players_to_close!==undefined)s.players_to_close=Math.max(2,Number(b.players_to_close)||2);if(b.show_room_after_full!==undefined)s.show_room_after_full=!!b.show_room_after_full;if(b.one_screenshot_per_match!==undefined)s.one_screenshot_per_match=!!b.one_screenshot_per_match;["my_match_label","upload_label","success_message"].forEach(k=>{if(b[k]!==undefined)s[k]=String(b[k]);});db.match_settings=s;writeDB(db);res.json({message:"Match settings saved",match_settings:s});});
app.get("/api/admin/profile-settings",admin,(req,res)=>res.json({profile_settings:readDB().profile_settings}));
app.put("/api/admin/profile-settings",admin,(req,res)=>{
 const db=readDB(),b=req.body||{},s=db.profile_settings||{};
 if(b.uid_prefix!==undefined)s.uid_prefix=String(b.uid_prefix).replace(/[^A-Za-z0-9]/g,"").slice(0,8)||"LI";
 ["profile_logo","uid_label","mobile_label","matches_label","statement_label"].forEach(k=>{if(b[k]!==undefined)s[k]=String(b[k]);});
 ["show_name","show_mobile","show_uid","show_matches","show_referral"].forEach(k=>{if(b[k]!==undefined)s[k]=!!b[k];});
 db.profile_settings=s;writeDB(db);res.json({message:"Profile settings saved",profile_settings:s});
});
app.get("/api/admin/maintenance",admin,(req,res)=>res.json({maintenance:readDB().maintenance||{enabled:false}}));
app.put("/api/admin/maintenance",admin,(req,res)=>{
 const db=readDB(),b=req.body||{},m=db.maintenance||{};
 if(b.enabled!==undefined)m.enabled=!!b.enabled;
 ["title","message","footer","button_text"].forEach(k=>{if(b[k]!==undefined)m[k]=String(b[k]);});
 db.maintenance=m;writeDB(db);res.json({message:m.enabled?"Maintenance mode enabled":"Maintenance mode disabled",maintenance:m});
});
app.get("/api/announcements",(req,res)=>{const db=readDB();res.json({items:(db.announcements||[]).filter(a=>a.enabled!==false),enabled:db.site_config?.features?.announcement!==false});});
app.get("/api/admin/announcements",admin,(req,res)=>res.json({items:readDB().announcements}));
app.post("/api/admin/announcements",admin,(req,res)=>{const db=readDB();const a={id:id(db.announcements),text:req.body.text||"",enabled:true,created_at:new Date().toISOString()};db.announcements.push(a);writeDB(db);res.json({message:"Announcement created",announcement:a})});
app.post("/api/admin/announcements/:id/toggle",admin,(req,res)=>{const db=readDB(),a=db.announcements.find(x=>x.id==req.params.id);if(!a)return res.status(404).json({message:"Not found"});a.enabled=!a.enabled;writeDB(db);res.json({message:"Updated"})});
app.delete("/api/admin/announcements/:id",admin,(req,res)=>{const db=readDB();db.announcements=db.announcements.filter(x=>x.id!=req.params.id);writeDB(db);res.json({message:"Deleted"})});

app.use("/uploads",express.static(UPLOAD_DIR,{dotfiles:"deny",index:false}));
const PAYMENT_LOGO_DIR=path.join(ROOT,"payment-logos");
fs.mkdirSync(PAYMENT_LOGO_DIR,{recursive:true});
app.use("/payment-logos",express.static(PAYMENT_LOGO_DIR,{dotfiles:"deny",index:false}));

// Never expose server.js, database.json, package files or other source files as public static assets.
const PUBLIC_FILES=new Set(["index.html","admin.html","manifest.json","sw.js","logo.svg","logo.png","ludo-income-logo.jpg","ludo-income-logo.svg","ludo-income-main-logo.jpg","ludo-income-main-logo.svg","ludo-income-cover.jpg","ludo-income-cover.svg","cover.svg","icon-192.png","icon-512.png","bkash-personal.jpg","bkash-merchant.jpg","nagad-personal.jpg"]);
app.get("/:file",(req,res,next)=>{const file=String(req.params.file||"");if(!PUBLIC_FILES.has(file))return next();res.sendFile(path.join(ROOT,file));});
app.get("/",(req,res)=>res.sendFile(path.join(ROOT,"index.html")));
app.get("/admin",(req,res)=>{
  const publicAdmin=path.join(ROOT,"public","admin.html");
  const rootAdmin=path.join(ROOT,"admin.html");
  if(fs.existsSync(publicAdmin)) return res.sendFile(publicAdmin);
  if(fs.existsSync(rootAdmin)) return res.sendFile(rootAdmin);
  return res.status(404).send("Admin panel file not found");
});

app.use((err,req,res,next)=>{
  if(err?.code==="LIMIT_FILE_SIZE") return res.status(413).json({message:"Uploaded file is too large"});
  if(err?.message?.includes("Only PNG, JPG or WEBP")) return res.status(400).json({message:err.message});
  console.error("Unhandled request error:",err);
  return res.status(500).json({message:"Internal server error"});
});
app.use((req,res)=>res.status(404).send("Not Found"));
app.listen(PORT,"0.0.0.0",()=>console.log(`Ludo Income server running on port ${PORT}`));
