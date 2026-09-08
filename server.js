
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
if(!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE,JSON.stringify({users:[],balances:[],matches:[],match_players:[],transactions:[],winnings:[],support_messages:[],announcements:[]},null,2));

function readDB(){return JSON.parse(fs.readFileSync(DB_FILE,"utf8"))}
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

app.post("/api/auth/register",async(req,res)=>{
 const {name,mobile,password}=req.body;
 if(!name||!mobile||!password) return res.status(400).json({message:"Name, mobile and password required"});
 if(password.length<6) return res.status(400).json({message:"Password must be at least 6 characters"});
 const db=readDB();
 if(db.users.some(u=>u.mobile===mobile)) return res.status(409).json({message:"Mobile already registered"});
 const u={id:id(db.users),name,mobile,password:await bcrypt.hash(password,10),referral_code:"LI"+Math.random().toString(36).slice(2,8).toUpperCase(),blocked:false,created_at:new Date().toISOString()};
 db.users.push(u); db.balances.push({id:id(db.balances),user_id:u.id,gaming_balance:0,winning_balance:0}); writeDB(db);
 res.json({token:token({id:u.id,role:"user"}),user:{id:u.id,name:u.name,mobile:u.mobile,referral_code:u.referral_code}});
});
app.post("/api/auth/login",async(req,res)=>{
 const db=readDB(),u=db.users.find(x=>x.mobile===req.body.mobile);
 if(!u||!(await bcrypt.compare(req.body.password||"",u.password))) return res.status(401).json({message:"Invalid mobile or password"});
 if(u.blocked) return res.status(403).json({message:"Account blocked"});
 res.json({token:token({id:u.id,role:"user"}),user:{id:u.id,name:u.name,mobile:u.mobile,referral_code:u.referral_code}});
});
app.get("/api/user/profile",auth,(req,res)=>{
 const db=readDB(),u=db.users.find(x=>x.id===req.user.id); if(!u)return res.status(404).json({message:"User not found"});
 const {password,...safe}=u; res.json({user:safe});
});
app.get("/api/user/balance",auth,(req,res)=>res.json({balance:getBalance(readDB(),req.user.id)}));

app.get("/api/matches",auth,(req,res)=>{
 const db=readDB(); res.json({matches:db.matches.map(m=>({...m,players:db.match_players.filter(p=>p.match_id===m.id).length}))});
});
app.post("/api/matches/:id/join",auth,(req,res)=>{
 const db=readDB(),m=db.matches.find(x=>x.id==req.params.id); if(!m)return res.status(404).json({message:"Match not found"});
 if(db.match_players.some(p=>p.match_id==m.id&&p.user_id==req.user.id))return res.status(400).json({message:"Already joined"});
 const players=db.match_players.filter(p=>p.match_id==m.id).length;
 if(players>=Number(m.max_players))return res.status(400).json({message:"Match is full"});
 const b=getBalance(db,req.user.id),fee=Number(m.entry_fee)||0;
 if(Number(b.gaming_balance)<fee)return res.status(400).json({message:"Insufficient gaming balance"});
 b.gaming_balance-=fee; db.match_players.push({id:id(db.match_players),match_id:m.id,user_id:req.user.id,created_at:new Date().toISOString()});
 db.transactions.push({id:id(db.transactions),user_id:req.user.id,type:"match_entry",amount:fee,status:"approved",match_id:m.id,created_at:new Date().toISOString()}); writeDB(db);
 res.json({message:"Match joined successfully"});
});
app.post("/api/deposit",auth,(req,res)=>{
 const db=readDB(),amount=Number(req.body.amount); if(!amount||amount<=0)return res.status(400).json({message:"Invalid amount"});
 db.transactions.push({id:id(db.transactions),user_id:req.user.id,type:"deposit",method:req.body.method,amount,transaction_id:req.body.transaction_id,status:"pending",created_at:new Date().toISOString()});writeDB(db);res.json({message:"Deposit submitted for approval"});
});
app.post("/api/withdraw",auth,(req,res)=>{
 const db=readDB(),amount=Number(req.body.amount),b=getBalance(db,req.user.id);
 if(!amount||amount<=0)return res.status(400).json({message:"Invalid amount"});
 if(Number(b.winning_balance)<amount)return res.status(400).json({message:"Insufficient winning balance"});
 b.winning_balance-=amount;
 db.transactions.push({id:id(db.transactions),user_id:req.user.id,type:"withdraw",method:req.body.method,number:req.body.number,amount,status:"pending",created_at:new Date().toISOString()});writeDB(db);res.json({message:"Withdraw request submitted"});
});
app.get("/api/transactions",auth,(req,res)=>res.json({transactions:readDB().transactions.filter(x=>x.user_id===req.user.id).sort((a,b)=>b.id-a.id)}));
app.post("/api/winning",auth,upload.single("screenshot"),(req,res)=>{
 const db=readDB(); if(!req.file)return res.status(400).json({message:"Screenshot required"});
 db.winnings.push({id:id(db.winnings),user_id:req.user.id,match_id:Number(req.body.match_id),room_id:req.body.room_id,screenshot:"/uploads/"+req.file.filename,status:"pending",created_at:new Date().toISOString()});writeDB(db);res.json({message:"Winning submitted for verification"});
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
app.get("/api/admin/users",admin,(req,res)=>{
 const db=readDB(),q=(req.query.search||"").toLowerCase();
 res.json({users:db.users.filter(u=>!q||u.name.toLowerCase().includes(q)||u.mobile.includes(q)).map(u=>{const b=getBalance(db,u.id);return {id:u.id,name:u.name,mobile:u.mobile,referral_code:u.referral_code,blocked:!!u.blocked,gaming_balance:b.gaming_balance,winning_balance:b.winning_balance}})});
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
app.get("/api/admin/matches",admin,(req,res)=>{const db=readDB();res.json({matches:db.matches.map(m=>({...m,players:db.match_players.filter(p=>p.match_id===m.id).length}))})});
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
 if(req.params.action==="approve"){w.status="approved";const m=db.matches.find(x=>x.id===w.match_id);if(m)getBalance(db,w.user_id).winning_balance+=Number(m.prize||0)}
 else if(req.params.action==="reject")w.status="rejected";else return res.status(400).json({message:"Invalid action"});
 writeDB(db);res.json({message:"Winning "+req.params.action});
});
app.get("/api/admin/support",admin,(req,res)=>{const db=readDB();res.json({items:db.support_messages.map(s=>({...s,user:db.users.find(u=>u.id===s.user_id)?.mobile||"-"}))})});
app.post("/api/admin/support/:id/reply",admin,(req,res)=>{const db=readDB(),s=db.support_messages.find(x=>x.id==req.params.id);if(!s)return res.status(404).json({message:"Message not found"});s.reply=req.body.reply||"";s.status="replied";writeDB(db);res.json({message:"Reply saved"})});
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
