require("dotenv").config();
const express=require("express");
const cors=require("cors");
const bcrypt=require("bcryptjs");
const jwt=require("jsonwebtoken");
const {Pool}=require("pg");

const app=express();
app.use(cors());
app.use(express.json());

const PORT=process.env.PORT||3000;
const JWT_SECRET=process.env.JWT_SECRET||"change-this-secret";
const ADMIN_PHONES=(process.env.ADMIN_PHONES||"").split(',').map(x=>x.trim()).filter(Boolean);
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL?{rejectUnauthorized:false}:false});

async function init(){
 if(process.env.DATABASE_URL){
  await pool.query(`
   CREATE TABLE IF NOT EXISTS users(
    id SERIAL PRIMARY KEY,name VARCHAR(100) NOT NULL,phone VARCHAR(30) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,balance NUMERIC(12,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    account_id VARCHAR(6) UNIQUE,
    blocked BOOLEAN DEFAULT FALSE);
   CREATE TABLE IF NOT EXISTS transactions(
    id SERIAL PRIMARY KEY,user_id INTEGER REFERENCES users(id),trx_id VARCHAR(100) NOT NULL,
    amount NUMERIC(12,2) NOT NULL,method VARCHAR(20) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
   CREATE TABLE IF NOT EXISTS tournaments(
    id SERIAL PRIMARY KEY,name VARCHAR(120) NOT NULL,entry_fee NUMERIC(12,2) NOT NULL,
    prize NUMERIC(12,2) NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
  `);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS account_id VARCHAR(6)`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked BOOLEAN DEFAULT FALSE`);
  const missing=await pool.query("SELECT id FROM users WHERE account_id IS NULL");
  for(const row of missing.rows){
   let accountId;
   for(let i=0;i<100;i++){
    const candidate=String(Math.floor(100000+Math.random()*900000));
    const exists=await pool.query("SELECT 1 FROM users WHERE account_id=$1",[candidate]);
    if(!exists.rowCount){accountId=candidate;break;}
   }
   if(!accountId) throw new Error("Could not generate unique Account ID");
   await pool.query("UPDATE users SET account_id=$1 WHERE id=$2",[accountId,row.id]);
  }
 }
}
function isAdminPhone(phone){return ADMIN_PHONES.includes(String(phone||''));}
function admin(req,res,next){if(!isAdminPhone(req.user?.phone))return res.status(403).json({error:'Admin access required'});next();}

function auth(req,res,next){
 try{const h=req.headers.authorization||"";const token=h.startsWith("Bearer ")?h.slice(7):null;
 if(!token)return res.status(401).json({error:"Login required"});
 req.user=jwt.verify(token,JWT_SECRET);next();}catch(e){res.status(401).json({error:"Invalid token"});}
}
app.get("/",(req,res)=>res.json({ok:true,service:"LudoArena API"}));
app.get("/health",(req,res)=>res.json({status:"healthy"}));

app.post("/api/register",async(req,res)=>{
 try{const {name,phone,password}=req.body;
 if(!name||!phone||!password)return res.status(400).json({error:"Name, phone and password required"});
 if(!/^01\d{9}$/.test(phone))return res.status(400).json({error:"Invalid Bangladesh mobile number"});
 if(!/^\d{6}$/.test(String(password)))return res.status(400).json({error:"Password must be exactly 6 digits"});
 const hash=await bcrypt.hash(password,10);
 let accountId;
 for(let i=0;i<100;i++){
  const candidate=String(Math.floor(100000+Math.random()*900000));
  const exists=await pool.query("SELECT 1 FROM users WHERE account_id=$1",[candidate]);
  if(!exists.rowCount){accountId=candidate;break;}
 }
 if(!accountId)return res.status(500).json({error:"Could not create Account ID"});
 const r=await pool.query("INSERT INTO users(name,phone,password,account_id) VALUES($1,$2,$3,$4) RETURNING id,account_id,name,phone,balance",[name,phone,hash,accountId]);
 res.status(201).json({message:"Registered",user:r.rows[0]});
 }catch(e){res.status(400).json({error:e.code==="23505"?"Phone already registered":"Registration failed"});}
});

app.post("/api/login",async(req,res)=>{
 try{const {phone,password}=req.body;const r=await pool.query("SELECT * FROM users WHERE phone=$1",[phone]);
 if(!r.rows[0]||!(await bcrypt.compare(password,r.rows[0].password)))return res.status(401).json({error:"Invalid login"});
 const u=r.rows[0];
 if(u.blocked)return res.status(403).json({error:"Account is blocked"});
 const token=jwt.sign({id:u.id,phone:u.phone},JWT_SECRET,{expiresIn:"7d"});
 res.json({token,user:{id:u.id,account_id:u.account_id,name:u.name,phone:u.phone,balance:u.balance,blocked:u.blocked,is_admin:isAdminPhone(u.phone)}});
 }catch(e){res.status(500).json({error:"Login failed"});}
});

app.get("/api/profile",auth,async(req,res)=>{
 const r=await pool.query("SELECT id,account_id,name,phone,balance,blocked,created_at FROM users WHERE id=$1",[req.user.id]);
 if(!r.rows[0])return res.status(404).json({error:"User not found"});
 const u=r.rows[0];
 res.json({...u,is_admin:isAdminPhone(u.phone)});
});

app.post("/api/transaction",auth,async(req,res)=>{
 const {trx_id,amount,method}=req.body;
 if(!trx_id||!amount||!method)return res.status(400).json({error:"trx_id, amount and method required"});
 const r=await pool.query("INSERT INTO transactions(user_id,trx_id,amount,method) VALUES($1,$2,$3,$4) RETURNING *",[req.user.id,trx_id,amount,method]);
 res.status(201).json({message:"Transaction submitted",transaction:r.rows[0]});
});

app.get("/api/tournaments",async(req,res)=>{
 if(!process.env.DATABASE_URL)return res.json([]);
 const r=await pool.query("SELECT * FROM tournaments ORDER BY id DESC");res.json(r.rows);
});

app.listen(PORT,async()=>{try{await init();console.log("LudoArena API running on",PORT)}catch(e){console.error(e)}});