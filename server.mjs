import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import cors from "cors";
import pkg from "pg";

const { Pool } = pkg;

const app = express();

app.use(express.json());
app.use(cors());

/* ---------- DATABASE ---------- */

const pool = new Pool({
connectionString: process.env.DATABASE_URL,
ssl: { rejectUnauthorized: false }
});

/* ---------- VENUE MAP ---------- */

const VENUES = {
bangalore:3,
mysore:8,
mumbai:2,
pune:10,
hyderabad:11,
kolkata:1,
chennai:4
};

/* ---------- MEMORY ---------- */

let raceStore = {};
let scrapedResults = {};
let winnerReport = {};
let browserLog = {};
let compareLog = {};
let lastScrapeTime = "";

let detectedVenuesLog = [];
let scrapeUrlsLog = [];

let activeVenues = [];
let lastVenueUpdate = "";

/* ---------- DATE (INDIAN) ---------- */

function todayDate(){

const d=new Date(
new Date().toLocaleString("en-US",{timeZone:"Asia/Kolkata"})
);

const yyyy=d.getFullYear();
const mm=String(d.getMonth()+1).padStart(2,"0");
const dd=String(d.getDate()).padStart(2,"0");

return `${yyyy}-${mm}-${dd}`;

}

/* ---------- INDIA TIME ---------- */

function indiaTime(){

return new Date().toLocaleTimeString("en-IN",{
timeZone:"Asia/Kolkata"
});

}

/* ---------- HORSE NORMALIZER ---------- */

function normalizeHorse(name){

if(!name) return "";

return name
.toLowerCase()
.replace(/\(.*?\)/g,"")
.replace(/[^a-z0-9 ]/g,"")
.replace(/\s+/g," ")
.trim();

}

/* ---------- INIT DATABASE ---------- */

async function initDatabase(){

await pool.query(`

CREATE TABLE IF NOT EXISTS races (

id SERIAL PRIMARY KEY,
date TEXT,
race_time TEXT,
panel TEXT,
soda INTEGER,

UNIQUE(date,race_time,panel)

);

`);

await pool.query(`

CREATE TABLE IF NOT EXISTS horses (

id SERIAL PRIMARY KEY,
race_time TEXT,
horse TEXT,
tp_pnl INTEGER DEFAULT 0,
g3_pnl INTEGER DEFAULT 0,

UNIQUE(race_time,horse)

);

`);

console.log("DATABASE TABLES READY");

}

/* ---------- DETECT VENUES FROM HOMEPAGE ---------- */

async function detectVenues(){

try{

const res = await axios.get("https://www.indiarace.com/",{timeout:10000});

const $ = cheerio.load(res.data);

let found = [];

/* Only detect venue from Live Center marquee */

$(".marquee_inner_div .marquees a").each((i,el)=>{

const text = $(el).text().toLowerCase();

for(const v in VENUES){

if(text.includes(v)){

found.push({
name:v,
id:VENUES[v]
});

}

}

});

/* remove duplicates */

found = found.filter(
(v,i,self)=> i === self.findIndex(t => t.id === v.id)
);

detectedVenuesLog = found;

console.log("VENUES DETECTED:",found);

return found;

}catch(e){

console.log("VENUE DETECT ERROR",e);

return [];

}

}

/* ---------- UPDATE ACTIVE VENUES ---------- */

async function updateVenues(){

try{

const venues=await detectVenues();

activeVenues=venues;

lastVenueUpdate=indiaTime();

console.log("ACTIVE VENUES UPDATED:",activeVenues);

}catch(e){

console.log("VENUE UPDATE ERROR",e);

}

}

/* ---------- SCRAPE RESULTS ---------- */

async function scrapeResults(){

try{

const venues=activeVenues;

if(!venues.length){

console.log("NO VENUES DETECTED YET");
return;

}

const date=todayDate();

let results={};

scrapeUrlsLog=[];

for(const v of venues){

const url=`https://www.indiarace.com/Home/racingCenterEvent?venueId=${v.id}&event_date=${date}&race_type=RESULTS`;

scrapeUrlsLog.push(url);

console.log("SCRAPING:",url);

const res=await axios.get(url,{timeout:10000});

const $=cheerio.load(res.data);

$("div[id^='race-']").each((i,r)=>{

const raceTime=$(r)
.find(".archive_time h4")
.eq(1)
.text()
.trim()
.toUpperCase();

let winner="";
let withdrawn=[];

$(r).find("tbody tr").each((i,row)=>{

const pl=$(row).find("td").eq(0).text().trim();

const horse=$(row)
.find("td")
.eq(2)
.find("h5 a")
.text()
.trim();

const jockey=$(row).find("td").eq(5).text().trim();

if(pl==="1"){
winner=horse;
}

if(pl==="W" || jockey.toLowerCase().includes("withdrawn")){
withdrawn.push(horse);
}

});

if(raceTime){

results[raceTime]={
winner,
withdrawn,
venue:v.name
};

}

});

}

scrapedResults=results;

lastScrapeTime=indiaTime();

console.log("SCRAPED RESULTS:",results);

buildComparison();

}catch(e){

console.log("SCRAPE ERROR:",e);

}

}

/* ---------- AUTO SCRAPE ---------- */

setInterval(updateVenues,600000);   // 10 min
setInterval(scrapeResults,120000);  // 2 min

/* ---------- BUILD COMPARISON ---------- */

function buildComparison(){

Object.keys(raceStore).forEach(time=>{

const tp=raceStore[time]?.tp;
const g3=raceStore[time]?.g3;

let merged={};

if(tp){

tp.horses.forEach(h=>{

const n=normalizeHorse(h.name);

merged[n]={
horse:h.name,
tp:h.pnl,
g3:0
};

});

}

if(g3){

g3.horses.forEach(h=>{

const n=normalizeHorse(h.name);

if(!merged[n]){
merged[n]={horse:h.name,tp:0,g3:h.pnl};
}else{
merged[n].g3=h.pnl;
}

});

}

let winnerHorse=scrapedResults[time]?.winner;

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

});

}

/* ---------- RECEIVE BROWSER DATA ---------- */

app.post("/race-data",async(req,res)=>{

const {panel,raceTime,soda,horses}=req.body;

const today=todayDate();

if(!raceStore[raceTime]){
raceStore[raceTime]={};
}

if(!raceStore[raceTime][panel]){
raceStore[raceTime][panel]={soda:0,horses:[]};
}

raceStore[raceTime][panel].soda=soda;

horses.forEach(newHorse=>{

const n=normalizeHorse(newHorse.name);

const existing=raceStore[raceTime][panel].horses.find(
h=>normalizeHorse(h.name)===n
);

if(existing){
existing.pnl=newHorse.pnl;
}else{
raceStore[raceTime][panel].horses.push(newHorse);
}

});

await pool.query(

`INSERT INTO races(date,race_time,panel,soda)
VALUES($1,$2,$3,$4)
ON CONFLICT (date,race_time,panel)
DO UPDATE SET soda=$4`,

[today,raceTime,panel,soda]

);

for(const h of horses){

await pool.query(

`INSERT INTO horses(race_time,horse,tp_pnl,g3_pnl)
VALUES($1,$2,$3,$4)
ON CONFLICT (race_time,horse)
DO UPDATE SET
tp_pnl = CASE WHEN $3>0 THEN $3 ELSE horses.tp_pnl END,
g3_pnl = CASE WHEN $4>0 THEN $4 ELSE horses.g3_pnl END`,

[
raceTime,
h.name,
panel==="tp"?h.pnl:0,
panel==="g3"?h.pnl:0
]

);

}

browserLog[raceTime]=req.body;

console.log("DATA RECEIVED:",raceTime,panel);

buildComparison();

res.json({status:"ok"});

});

/* ---------- DASHBOARD ---------- */

app.get("/dashboard",(req,res)=>{

let html=`

<h1>TP + G3 Winner Dashboard</h1>

<p>Last Scrape: ${lastScrapeTime}</p>

<p>Last Venue Update: ${lastVenueUpdate}</p>

<meta http-equiv="refresh" content="5">

<table border="1">

<tr>
<th>Race Time</th>
<th>Horse</th>
<th>TP Soda</th>
<th>G3 Soda</th>
<th>TP PNL</th>
<th>G3 PNL</th>
</tr>
`;

Object.keys(winnerReport).forEach(time=>{

const w=winnerReport[time];

if(!w) return;

const tpSoda=raceStore[time]?.tp?.soda||0;
const g3Soda=raceStore[time]?.g3?.soda||0;

html+=`

<tr style="background:lightgreen">
<td>${time}</td>
<td>${w.horse}</td>
<td>${tpSoda}</td>
<td>${g3Soda}</td>
<td>${w.tpPnl}</td>
<td>${w.g3Pnl}</td>
</tr>
`;

});

html+="</table>";

html+=`

<hr>

<h2>SCRAPER DEBUG</h2>

<h3>Detected Venues</h3>
<pre>${JSON.stringify(detectedVenuesLog,null,2)}</pre>

<h3>Active Venues</h3>
<pre>${JSON.stringify(activeVenues,null,2)}</pre>

<h3>Scraping URLs</h3>
<pre>${JSON.stringify(scrapeUrlsLog,null,2)}</pre>

<h3>Scraped Results</h3>
<pre>${JSON.stringify(scrapedResults,null,2)}</pre>

<h3>Browser Data</h3>
<pre>${JSON.stringify(browserLog,null,2)}</pre>

<h3>Comparison Data</h3>
<pre>${JSON.stringify(compareLog,null,2)}</pre>

`;

res.send(html);

});

/* ---------- HOME ---------- */

app.get("/",(req,res)=>{
res.send(`
<h2>TP + G3 Server Running</h2>
<a href="/dashboard">Open Dashboard</a>
`);
});

/* ---------- SERVER ---------- */

const PORT=process.env.PORT || 3000;

async function startServer(){

await initDatabase();

await updateVenues();

await scrapeResults();

app.listen(PORT,()=>{

console.log("================================");
console.log("TP + G3 SERVER RUNNING");
console.log("PORT:",PORT);
console.log("================================");

});

}

startServer();
