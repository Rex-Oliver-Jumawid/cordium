"use strict";
// Vercel Express entry point. No MongoDB connection is started.
const app=require("./backend/src/supabase/app");
if(require.main===module) {
  const port=Number(process.env.PORT)||3000;
  app.listen(port,()=>console.log("Cordium listening on port "+port));
}
module.exports=app;
