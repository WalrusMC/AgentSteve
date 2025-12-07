import express from "express";
import { googleOAuth } from "./controllers/googleOAuth.js";

const router = express.Router();

router.get("/oauth/google/callback", googleOAuth);

export default router;