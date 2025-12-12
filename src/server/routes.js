import express from "express";
import { googleOAuth } from "./controllers/googleOAuth.js";
import { serverAccessPageWepwawet } from "./controllers/serverAccess/page/wepwawet.js";
import { serverAccessCheckerWepwawet } from "./controllers/serverAccess/checker/wepwawet.js";

const router = express.Router();

router.get("/oauth/google/callback", googleOAuth);
router.get("/aiagents/serveraccess/wepwawet", serverAccessPageWepwawet);
router.post("/aiagents/serveraccess/wepwawet/check", serverAccessCheckerWepwawet);

export default router;