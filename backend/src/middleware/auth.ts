import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";

export interface JWTPayload {
  userId: string;
  organizationId: string;
  email: string;
}

// Extend Express Request so downstream handlers get typed req.user.
declare global {
  namespace Express {
    interface Request {
      user: JWTPayload;
    }
  }
}

export function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or malformed Authorization header", code: "AUTH_MISSING" });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, config.jwtSecret) as JWTPayload;

    if (!payload.userId || !payload.organizationId) {
      res.status(401).json({ error: "Invalid token claims", code: "AUTH_INVALID_CLAIMS" });
      return;
    }

    req.user = payload;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: "Token expired", code: "AUTH_TOKEN_EXPIRED" });
      return;
    }
    res.status(401).json({ error: "Invalid token", code: "AUTH_INVALID_TOKEN" });
  }
}
