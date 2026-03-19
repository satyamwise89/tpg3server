import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import cors from "cors";
import pkg from "pg";
import fs from "fs";

const { Pool } = pkg;

const app = express();

app.use(express.json());
app.use(cors({
origin:"*",
methods:["GET","POST"],
allowedHeaders:["Content-Type"]
}));

/* ---------- TELEGRAM ---------- */

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

let sentRaces = {};

/* ---------- DATABASE ---------- */

const pool = new Pool({
connectionString: process.env.DATABASE_URL,
ssl:{rejectUnauthorized:false}
});

/* ---------- VENUE MAP ---------- */

const VENUES={
bangalore:3,
mysore:8,
mumbai:2,
pune:10,
hyderabad:11,
kolkata:1,
chennai:4
};

/* ---------- MEMORY ---------- */

let raceStore={};
let scrapedResults={};
let winnerReport={};
let browserLog={};
let compareLog={};

let detectedVenuesLog=[];
let scrapeUrlsLog=[];

let activeVenues=[];
let lastVenueUpdate="";
let lastScrapeTime="";

/* ---------- STATE SAVE/LOAD ---------- */

function saveState(){
try{
fs.writeFileSync("state.json",JSON.stringify({
raceStore,
scrapedResults,
winnerReport,
compareLog,
lastScrapeTime,
lastVenueUpdate,
sentRaces
}));
}catch(e){
console.log("SAVE ERROR",e);
}
}

function loadState(){
try{
const d=JSON.parse(fs.readFileSync("state.json"));

raceStore=d.raceStore||{};
scrapedResults=d.scrapedResults||{};
winnerReport=d.winnerReport||{};
compareLog=d.compareLog||{};
lastScrapeTime=d.lastScrapeTime||"";
lastVenueUpdate=d.lastVenueUpdate||"";
sentRaces=d.sentRaces||{};

console.log("✅ STATE RESTORED");

}catch(e){
console.log("No old state");
}
}

/* ---------- TELEGRAM FUNCTION ---------- */

async function sendTelegram(msg){
try{
await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,{
chat_id: CHAT_ID,
text: msg,
parse_mode: "HTML"
});
}catch(e){
console.log("Telegram Error", e.message);
}
}

/* ---------- HELPERS ---------- */

function delay(ms){
return new Promise(r=>setTimeout(r,ms));
}

function todayDate(){
const d=new Date(new Date().toLocaleString("en-US",{timeZone:"Asia/Kolkata"}));
return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function indiaTime(){
return new Date().toLocaleTimeString("en-IN",{timeZone:"Asia/Kolkata"});
}

function normalizeHorse(name){
if(!name) return "";
return name.toLowerCase()
.replace(/^\d+\.\s*/,"")
.replace(/\(.*?\)/g,"")
.replace(/[^a-z ]/g,"")
.replace(/\s+/g," ")
.trim();
}

function normalizeTime(t){
if(!t) return "";
return t.toUpperCase()
.replace(/\s+/g,"")
.replace(/^0/,"")
.replace(":00","");
}

/* ---------- INIT DATABASE ---------- */

async function initDatabase(){
await pool.query(`
CREATE TABLE IF NOT EXISTS races(
id SERIAL PRIMARY KEY,
date TEXT,
race_time TEXT,
panel TEXT,
soda INTEGER,
UNIQUE(date,race_time,panel)
);
`);

await pool.query(`
CREATE TABLE IF NOT EXISTS horses(
id SERIAL PRIMARY KEY,
race_time TEXT,
horse TEXT,
tp_pnl INTEGER DEFAULT 0,
g3_pnl INTEGER DEFAULT 0,
UNIQUE(race_time,horse)
);
`);

console.log("DATABASE READY");
}

/* ---------- DETECT VENUES ---------- */

async function detectVenues(){
try{
const res=await axios.get("https://www.indiarace.com/",{timeout:10000});
const $=cheerio.load(res.data);

let found=[];

$(".marquee_inner_div .marquees a").each((i,el)=>{
const text=$(el).text().toLowerCase();
for(const v in VENUES){
if(text.includes(v)){
found.push({name:v,id:VENUES[v]});
}
}
});

found=found.filter((v,i,self)=>i===self.findIndex(t=>t.id===v.id));
detectedVenuesLog=found;

return found;

}catch(e){
console.log("VENUE ERROR",e);
return[];
}
}

/* ---------- UPDATE VENUES ---------- */

async function updateVenues(){
activeVenues=await detectVenues();
lastVenueUpdate=indiaTime();
}

/* ---------- SCRAPE RESULTS ---------- */

async function scrapeResults(){

if(!activeVenues.length) return;

const date=todayDate();
let results={};

scrapeUrlsLog=[];

for(const v of activeVenues){

await delay(2000);

const url=`https://www.indiarace.com/Home/racingCenterEvent?venueId=${v.id}&event_date=${date}&race_type=RESULTS`;
scrapeUrlsLog.push(url);

const res=await axios.get(url,{timeout:10000});
const $=cheerio.load(res.data);

$("div[id^='race-']").each((i,r)=>{

const raceTime=$(r).find(".archive_time h4").eq(1).text().trim().toUpperCase();

let winner="";

$(r).find("tbody tr").each((i,row)=>{
const pl=$(row).find("td").eq(0).text().trim();
const horse=$(row).find("td").eq(2).find("h5 a").text().trim();
if(pl==="1") winner=horse;
});

if(raceTime){
results[raceTime]={winner,venue:v.name};
}

});

}

if(Object.keys(results).length>0){
scrapedResults=results;
lastScrapeTime=indiaTime();
}

buildComparison();
saveState();
}

/* ---------- AUTO ---------- */

setInterval(updateVenues,600000);
setInterval(scrapeResults,180000);

/* ---------- BUILD COMPARISON ---------- */

function buildComparison(){

Object.keys(raceStore).forEach(time=>{

const tp=raceStore[time]?.tp;
const g3=raceStore[time]?.g3;

let merged={};

if(tp){
tp.horses.forEach(h=>{
merged[normalizeHorse(h.name)]={horse:h.name,tp:h.pnl,g3:0};
});
}

if(g3){
g3.horses.forEach(h=>{
const n=normalizeHorse(h.name);
if(!merged[n]) merged[n]={horse:h.name,tp:0,g3:h.pnl};
else merged[n].g3=h.pnl;
});
}

let winnerHorse=null;

Object.keys(scrapedResults).forEach(st=>{
if(normalizeTime(st)===normalizeTime(time)){
winnerHorse=scrapedResults[st].winner;
}
});

let winnerData=null;

if(winnerHorse){
const wn=normalizeHorse(winnerHorse);
if(merged[wn]){
winnerData={
horse:winnerHorse,
tpPnl:merged[wn].tp,
g3Pnl:merged[wn].g3
};
}
}

winnerReport[time]=winnerData;
compareLog[time]=merged;

/* ---------- TELEGRAM ---------- */

if(winnerData){

const key = time + "_" + winnerData.horse;

if(!sentRaces[key]){

const tpSoda = raceStore[time]?.tp?.soda || 0;
const g3Soda = raceStore[time]?.g3?.soda || 0;

const msg = `
<pre>
🏁 TP + G3 RESULT

Time      Horse         TP Soda   G3 Soda   TP        G3
----------------------------------------------------------
${time.padEnd(9)} ${winnerData.horse.padEnd(12)} ${String(tpSoda).padEnd(8)} ${String(g3Soda).padEnd(8)} ${String(winnerData.tpPnl).padEnd(9)} ${String(winnerData.g3Pnl)}
</pre>
`;

sendTelegram(msg);

sentRaces[key]=true;
saveState();

}

}

});

}

/* ---------- RECEIVE DATA ---------- */

app.post("/race-data",(req,res)=>{

const {panel,raceTime,soda,horses}=req.body;

if(!raceStore[raceTime]) raceStore[raceTime]={};

if(!raceStore[raceTime][panel]){
raceStore[raceTime][panel]={soda:0,horses:[]};
}

raceStore[raceTime][panel].soda=soda;

if(horses && horses.length>0){
horses.forEach(h=>{
const n=normalizeHorse(h.name);
const ex=raceStore[raceTime][panel].horses.find(x=>normalizeHorse(x.name)===n);
if(ex) ex.pnl=h.pnl;
else raceStore[raceTime][panel].horses.push(h);
});
}

buildComparison();
saveState();

res.json({status:"ok"});

});

/* ---------- START ---------- */

const PORT=process.env.PORT || 3000;

async function startServer(){
await initDatabase();
loadState();
await updateVenues();
await scrapeResults();

app.listen(PORT,()=>console.log("SERVER RUNNING",PORT));
}

startServer();
sendTelegram("✅ TELEGRAM CONNECTED");
