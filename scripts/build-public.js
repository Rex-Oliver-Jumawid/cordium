"use strict";
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const publicDir=path.join(root,"public");
const folders=["html","css","js","images","favicon"];
fs.mkdirSync(publicDir,{recursive:true});
for(const folder of folders) {
  fs.cpSync(path.join(root,folder),path.join(publicDir,folder),
    {recursive:true,force:true,filter:(file)=>!path.basename(file).startsWith(".")});
}
console.log("Vercel public assets copied from approved frontend directories.");
