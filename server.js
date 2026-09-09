
const express=require("express");
const cors=require("cors");
const fs=require("fs");
const path=require("path");
const bcrypt=require("bcryptjs");
const jwt=require("jsonwebtoken");
const multer=require("multer");

const app=express();
app.use(cors());
app.use(express.json({limit:"2mb"}));
app.use(express.urlencoded({extended:true}));

const PORT=process.env.PORT||3000;
const JWT_SECRET=process.env.JWT_SECRET||"CHANGE_THIS_JWT_SECRET";
const ADMIN_MOBILE=process.env.ADMIN_MOBILE||"01700000000";
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||"ChangeMe123!";

const ROOT=__dirname, DATA_DIR=path.join(ROOT,"data"), UPLOAD_DIR=path.join(ROOT,"uploads");
fs.mkdirSync(DATA_DIR,{recursive:true}); fs.mkdirSync(UPLOAD_DIR,{recursive:true});
const DB_FILE=path.join(DATA_DIR,"database.json");
if(!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE,JSON.stringify({users:[],balances:[],matches:[],match_players:[],transactions:[],winnings:[],support_messages:[],announcements:[],payment_settings:{bkash:{number:"01301470686",label:"Personal",enabled:true,logo_url:"/payment-logos/bkash-personal.jpg?v=2"},nagad:{number:"01806097369",label:"Personal",enabled:true,logo_url:"/payment-logos/nagad-personal.jpg?v=2"},bkash_merchant:{number:"01301470686",label:"Merchant",enabled:true,logo_url:"/payment-logos/bkash-merchant.jpg?v=2"},min_deposit:10,instructions:["কমপক্ষে ১০ টাকা ডিপোজিট করা যাবে।","টাকা পাঠানোর পর bKash/Nagad Statement বা Transaction History থেকে Transaction ID নিন।","Transaction ID অবশ্যই জমা দিতে হবে।","সঠিক Transaction ID না দিলে ডিপোজিট approve হবে না এবং balance-এ টাকা যোগ হবে না।"]},maintenance:{enabled:false,title:"🔧 Update চলছে",message:"আমাদের Ludo Income App বর্তমানে আপডেট করা হচ্ছে। Update শেষ হলে আবার প্রবেশ করতে পারবেন।",footer:"এতক্ষণ আমাদের সাথে থাকার জন্য ধন্যবাদ ❤️",button_text:"🔄 আবার চেষ্টা করুন"},profile_settings:{uid_prefix:"LI",profile_logo:"👨‍🦱",show_name:true,show_mobile:true,show_uid:true,show_matches:true,show_referral:true,uid_label:"UID Code",mobile_label:"Mobile Number",matches_label:"🎮 Matches",statement_label:"📒 My Statement"},match_settings:{players_to_close:2,show_room_after_full:true,my_match_label:"🎉 My Match 🎉",upload_label:"📸 Upload Winning Screenshot",success_message:"Screenshot submitted successfully!"}},null,2));

function readDB(){
  const db=JSON.parse(fs.readFileSync(DB_FILE,"utf8"));
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
function writeDB(db){fs.writeFileSync(DB_FILE,JSON.stringify(db,null,2))}
function id(arr){return arr.length?Math.max(...arr.map(x=>Number(x.id)||0))+1:1}
function token(payload){return jwt.sign(payload,JWT_SECRET,{expiresIn:"30d"})}
function auth(req,res,next){
  try{
    const h=req.headers.authorization||"";
    if(!h.startsWith("Bearer ")) throw new Error();
    req.user=jwt.verify(h.slice(7),JWT_SECRET); next();
  }catch(e){res.status(401).json({message:"Unauthorized"})}
}
function admin(req,res,next){auth(req,res,()=>{if(req.user.role!=="admin") return res.status(403).json({message:"Admin only"}); next()})}
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
 filename:(req,file,cb)=>cb(null,Date.now()+"-"+Math.random().toString(36).slice(2)+path.extname(file.originalname))
}),limits:{fileSize:5*1024*1024}});

app.get("/api/health",(req,res)=>res.json({ok:true,service:"Ludo Income"}));

function makeUid(db){
  const prefix=String(db.profile_settings?.uid_prefix||"LI").replace(/[^A-Za-z0-9]/g,"").slice(0,8)||"LI";
  let code="";
  do { code=prefix+"-"+Math.random().toString(36).slice(2,10).toUpperCase(); } while(db.users.some(u=>u.uid_code===code));
  return code;
}

app.post("/api/auth/register",async(req,res)=>{
 const {name,mobile,password}=req.body;
 if(!name||!mobile||!password) return res.status(400).json({message:"Name, mobile and password required"});
 if(password.length<6) return res.status(400).json({message:"Password must be at least 6 characters"});
 const db=readDB();
 if(db.users.some(u=>u.mobile===mobile)) return res.status(409).json({message:"Mobile already registered"});
 const u={id:id(db.users),name,mobile,password:await bcrypt.hash(password,10),uid_code:makeUid(db),referral_code:"LI"+Math.random().toString(36).slice(2,8).toUpperCase(),blocked:false,created_at:new Date().toISOString()};
 db.users.push(u); db.balances.push({id:id(db.balances),user_id:u.id,gaming_balance:0,winning_balance:0}); writeDB(db);
 res.json({token:token({id:u.id,role:"user"}),user:{id:u.id,name:u.name,mobile:u.mobile,uid_code:u.uid_code,referral_code:u.referral_code}});
});
app.post("/api/auth/login",async(req,res)=>{
 const db=readDB(),u=db.users.find(x=>x.mobile===req.body.mobile);
 if(!u||!(await bcrypt.compare(req.body.password||"",u.password))) return res.status(401).json({message:"Invalid mobile or password"});
 if(u.blocked) return res.status(403).json({message:"Account blocked"});
 res.json({token:token({id:u.id,role:"user"}),user:{id:u.id,name:u.name,mobile:u.mobile,uid_code:u.uid_code,referral_code:u.referral_code}});
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
 const db=readDB(), threshold=Number(db.match_settings?.players_to_close||2);
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
 const db=readDB(),m=db.matches.find(x=>x.id==req.params.id); if(!m)return res.status(404).json({message:"Match not found"});
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
 const db=readDB(),amount=Number(req.body.amount),method=String(req.body.method||"").toLowerCase(),tx=String(req.body.transaction_id||"").trim();
 const s=db.payment_settings;
 if(!["bkash","nagad","bkash_merchant"].includes(method)) return res.status(400).json({message:"Invalid payment method"});
 if(!s[method] || s[method].enabled===false) return res.status(400).json({message:"এই payment method এখন বন্ধ আছে"});
 if(!amount||amount<=0) return res.status(400).json({message:"সঠিক amount দিন"});
 if(amount<Number(s.min_deposit||10)) return res.status(400).json({message:"Minimum deposit is ৳"+Number(s.min_deposit||10)});
 if(!tx) return res.status(400).json({message:"Transaction ID অবশ্যই দিতে হবে"});
 const duplicate=db.transactions.some(t=>t.type==="deposit"&&String(t.transaction_id||"").toLowerCase()===tx.toLowerCase());
 if(duplicate) return res.status(400).json({message:"এই Transaction ID আগে জমা দেওয়া হয়েছে"});
 db.transactions.push({id:id(db.transactions),user_id:req.user.id,type:"deposit",method,amount,transaction_id:tx,status:"pending",created_at:new Date().toISOString()});
 writeDB(db);res.json({message:"Deposit submitted for approval"});
});
app.post("/api/withdraw",auth,(req,res)=>{
 const db=readDB(),amount=Number(req.body.amount),b=getBalance(db,req.user.id);
 if(!amount||amount<=0)return res.status(400).json({message:"Invalid amount"});
 if(Number(b.winning_balance)<amount)return res.status(400).json({message:"Insufficient winning balance"});
 b.winning_balance-=amount;
 db.transactions.push({id:id(db.transactions),user_id:req.user.id,type:"withdraw",method:req.body.method,number:req.body.number,amount,status:"pending",created_at:new Date().toISOString()});writeDB(db);res.json({message:"Withdraw request submitted"});
});
app.get("/api/transactions",auth,(req,res)=>res.json({transactions:readDB().transactions.filter(x=>x.user_id===req.user.id).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))}));
app.get("/api/user/statement",auth,(req,res)=>{
 const db=readDB(),uid=req.user.id;
 const events=[];
 const userTx=db.transactions.filter(t=>t.user_id===uid);
 userTx.forEach(t=>{
   if(t.type==="deposit") events.push({id:"t"+t.id,type:"deposit",title:"Deposit",amount:Number(t.amount||0),status:t.status,method:t.method,transaction_id:t.transaction_id,created_at:t.created_at});
   else if(t.type==="withdraw") events.push({id:"t"+t.id,type:"withdraw",title:"Withdraw",amount:-Number(t.amount||0),status:t.status,method:t.method,created_at:t.created_at});
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
 const db=readDB(),matchId=Number(req.body.match_id);
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
 const db=readDB(); if(!req.body.message)return res.status(400).json({message:"Message required"});
 db.support_messages.push({id:id(db.support_messages),user_id:req.user.id,message:req.body.message,reply:"",status:"open",created_at:new Date().toISOString()});writeDB(db);res.json({message:"Message sent"});
});

/* Admin */
app.post("/api/admin/login",(req,res)=>{
 if(req.body.mobile!==ADMIN_MOBILE||req.body.password!==ADMIN_PASSWORD)return res.status(401).json({message:"Invalid admin credentials"});
 res.json({token:token({id:0,role:"admin"})});
});
app.get("/api/admin/stats",admin,(req,res)=>{
 const db=readDB(); res.json({
  users:db.users.length,
  gaming_balance:db.balances.reduce((s,b)=>s+Number(b.gaming_balance||0),0),
  winning_balance:db.balances.reduce((s,b)=>s+Number(b.winning_balance||0),0),
  pending_requests:db.transactions.filter(x=>x.status==="pending").length+db.winnings.filter(x=>x.status==="pending").length
 });
});
app.get("/api/admin/users/:id/profile",admin,(req,res)=>{const db=readDB(),u=db.users.find(x=>x.id==req.params.id);if(!u)return res.status(404).json({message:"User not found"});const b=getBalance(db,u.id);res.json({user:{id:u.id,name:u.name,mobile:u.mobile,uid_code:u.uid_code||"",referral_code:u.referral_code||"",created_at:u.created_at,blocked:!!u.blocked},balance:b,matches:db.match_players.filter(p=>p.user_id===u.id).map(p=>{const m=db.matches.find(x=>x.id===p.match_id);return {match_id:p.match_id,title:m?.title||"Ludo Match",entry_fee:Number(m?.entry_fee||0),status:m?.status||"",joined_at:p.created_at}})});});
app.get("/api/admin/users",admin,(req,res)=>{
 const db=readDB(),q=(req.query.search||"").toLowerCase();
 res.json({users:db.users.filter(u=>!q||u.name.toLowerCase().includes(q)||u.mobile.includes(q)).map(u=>{const b=getBalance(db,u.id);return {id:u.id,name:u.name,mobile:u.mobile,uid_code:u.uid_code||"",referral_code:u.referral_code,blocked:!!u.blocked,matches:db.match_players.filter(p=>p.user_id===u.id).length,gaming_balance:b.gaming_balance,winning_balance:b.winning_balance}})});
});
app.post("/api/admin/users/:id/block",admin,(req,res)=>{const db=readDB(),u=db.users.find(x=>x.id==req.params.id);if(!u)return res.status(404).json({message:"User not found"});u.blocked=req.body.blocked!==false;writeDB(db);res.json({message:"Updated"})});
app.post("/api/admin/users/:id/balance",admin,(req,res)=>{
 const db=readDB(),b=getBalance(db,Number(req.params.id)),g=Number(req.body.gaming_delta||0),w=Number(req.body.winning_delta||0);
 b.gaming_balance+=g;b.winning_balance+=w;writeDB(db);res.json({message:"Balance updated",balance:b});
});
app.get("/api/admin/deposits",admin,(req,res)=>{const db=readDB();res.json({items:db.transactions.filter(x=>x.type==="deposit").map(t=>({...t,user:db.users.find(u=>u.id===t.user_id)?.mobile||"-"}))})});
app.post("/api/admin/deposits/:id/:action",admin,(req,res)=>{
 const db=readDB(),t=db.transactions.find(x=>x.id==req.params.id&&x.type==="deposit");if(!t)return res.status(404).json({message:"Deposit not found"});
 if(t.status!=="pending")return res.status(400).json({message:"Already processed"});
 if(req.params.action==="approve"){t.status="approved";getBalance(db,t.user_id).gaming_balance+=Number(t.amount)}
 else if(req.params.action==="reject")t.status="rejected";else return res.status(400).json({message:"Invalid action"});
 writeDB(db);res.json({message:"Deposit "+req.params.action});
});
app.get("/api/admin/withdraws",admin,(req,res)=>{const db=readDB();res.json({items:db.transactions.filter(x=>x.type==="withdraw").map(t=>({...t,user:db.users.find(u=>u.id===t.user_id)?.mobile||"-"}))})});
app.post("/api/admin/withdraws/:id/:action",admin,(req,res)=>{
 const db=readDB(),t=db.transactions.find(x=>x.id==req.params.id&&x.type==="withdraw");if(!t)return res.status(404).json({message:"Withdraw not found"});
 if(t.status!=="pending")return res.status(400).json({message:"Already processed"});
 if(req.params.action==="approve")t.status="approved";
 else if(req.params.action==="reject"){t.status="rejected";getBalance(db,t.user_id).winning_balance+=Number(t.amount)}
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
 db.matches.push(m);writeDB(db);res.json({message:"Match created",match:m});
});
app.put("/api/admin/matches/:id",admin,(req,res)=>{
 const db=readDB(),m=db.matches.find(x=>x.id==req.params.id);if(!m)return res.status(404).json({message:"Match not found"});
 ["title","time","status","room_id"].forEach(k=>{if(req.body[k]!==undefined)m[k]=req.body[k]});
 ["entry_fee","prize","max_players"].forEach(k=>{if(req.body[k]!==undefined)m[k]=Number(req.body[k])});
 writeDB(db);res.json({message:"Match updated"});
});
app.delete("/api/admin/matches/:id",admin,(req,res)=>{const db=readDB(),i=db.matches.findIndex(x=>x.id==req.params.id);if(i<0)return res.status(404).json({message:"Match not found"});db.matches.splice(i,1);db.match_players=db.match_players.filter(x=>x.match_id!=req.params.id);writeDB(db);res.json({message:"Match deleted"})});
app.get("/api/admin/winnings",admin,(req,res)=>{const db=readDB();res.json({items:db.winnings.map(w=>({...w,user:db.users.find(u=>u.id===w.user_id)?.mobile||"-"}))})});
app.post("/api/admin/winnings/:id/:action",admin,(req,res)=>{
 const db=readDB(),w=db.winnings.find(x=>x.id==req.params.id);if(!w)return res.status(404).json({message:"Winning not found"});
 if(w.status!=="pending")return res.status(400).json({message:"Already processed"});
 if(req.params.action==="approve"){w.status="approved";const m=db.matches.find(x=>x.id===w.match_id);if(m){const prize=Number(m.prize||0);getBalance(db,w.user_id).winning_balance+=prize;db.transactions.push({id:id(db.transactions),user_id:w.user_id,type:"match_profit",amount:prize,status:"approved",match_id:w.match_id,created_at:new Date().toISOString()});}}
 else if(req.params.action==="reject")w.status="rejected";else return res.status(400).json({message:"Invalid action"});
 writeDB(db);res.json({message:"Winning "+req.params.action});
});
app.get("/api/admin/support",admin,(req,res)=>{const db=readDB();res.json({items:db.support_messages.map(s=>({...s,user:db.users.find(u=>u.id===s.user_id)?.mobile||"-"}))})});
app.post("/api/admin/support/:id/reply",admin,(req,res)=>{const db=readDB(),s=db.support_messages.find(x=>x.id==req.params.id);if(!s)return res.status(404).json({message:"Message not found"});s.reply=req.body.reply||"";s.status="replied";writeDB(db);res.json({message:"Reply saved"})});
app.get("/api/admin/payment-settings",admin,(req,res)=>res.json({payment_settings:readDB().payment_settings}));
app.put("/api/admin/payment-settings",admin,(req,res)=>{
 const db=readDB(),body=req.body||{},s=db.payment_settings;
 for(const m of ["bkash","nagad","bkash_merchant"]){
   const x=body[m]||{};
   if(x.number!==undefined) s[m].number=String(x.number).trim();
   if(x.label!==undefined) s[m].label=String(x.label).trim()||"Personal";
   if(x.enabled!==undefined) s[m].enabled=!!x.enabled;
   if(x.logo_url!==undefined) s[m].logo_url=String(x.logo_url).trim();
 }
 if(body.min_deposit!==undefined){const n=Number(body.min_deposit);if(!Number.isFinite(n)||n<1)return res.status(400).json({message:"Minimum deposit must be at least 1"});s.min_deposit=n}
 if(Array.isArray(body.instructions)) s.instructions=body.instructions.map(x=>String(x).trim()).filter(Boolean).slice(0,10);
 writeDB(db);res.json({message:"Payment settings saved",payment_settings:s});
});
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
app.get("/api/admin/announcements",admin,(req,res)=>res.json({items:readDB().announcements}));
app.post("/api/admin/announcements",admin,(req,res)=>{const db=readDB();const a={id:id(db.announcements),text:req.body.text||"",enabled:true,created_at:new Date().toISOString()};db.announcements.push(a);writeDB(db);res.json({message:"Announcement created",announcement:a})});
app.post("/api/admin/announcements/:id/toggle",admin,(req,res)=>{const db=readDB(),a=db.announcements.find(x=>x.id==req.params.id);if(!a)return res.status(404).json({message:"Not found"});a.enabled=!a.enabled;writeDB(db);res.json({message:"Updated"})});
app.delete("/api/admin/announcements/:id",admin,(req,res)=>{const db=readDB();db.announcements=db.announcements.filter(x=>x.id!=req.params.id);writeDB(db);res.json({message:"Deleted"})});

app.use("/uploads",express.static(UPLOAD_DIR));
app.get("/admin",(req,res)=>{
  const publicAdmin=path.join(ROOT,"public","admin.html");
  const rootAdmin=path.join(ROOT,"admin.html");
  if(fs.existsSync(publicAdmin)) return res.sendFile(publicAdmin);
  if(fs.existsSync(rootAdmin)) return res.sendFile(rootAdmin);
  return res.status(404).send("Admin panel file not found");
});
app.get("/",(req,res)=>res.sendFile(path.join(ROOT,"index.html")));
app.use(express.static(ROOT));
app.use((req,res)=>res.status(404).send("Not Found"));
app.listen(PORT,"0.0.0.0",()=>console.log(`Ludo Income server running on port ${PORT}`));
