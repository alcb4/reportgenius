import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { PrismaClient, Prisma } from "@prisma/client";
import { config } from "../config";

const router = Router();
const prisma = new PrismaClient();

// ── Zod schemas ────────────────────────────────────────────────────────────────

const RegisterSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  orgName: z.string().min(1, "Organisation name is required").max(255),
});

const LoginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function signToken(userId: string, organizationId: string, email: string): string {
  return jwt.sign(
    { userId, organizationId, email },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn } as jwt.SignOptions
  );
}

// ── POST /api/v1/auth/register ─────────────────────────────────────────────────

router.post(
  "/register",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = RegisterSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.errors.map((e) => e.message).join(", "),
          code: "VALIDATION_ERROR",
        });
        return;
      }

      const { email, password, orgName } = parsed.data;

      // Check for existing email.
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        res.status(409).json({ error: "Email already registered", code: "EMAIL_EXISTS" });
        return;
      }

      const passwordHash = await bcrypt.hash(password, config.bcryptRounds);

      // Create org + user in a single transaction.
      const { user, organization } = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const organization = await tx.organization.create({
          data: { name: orgName },
          select: { id: true, name: true },
        });

        const user = await tx.user.create({
          data: {
            email,
            password_hash: passwordHash,
            organization_id: organization.id,
          },
          select: { id: true, email: true, organization_id: true, created_at: true },
        });

        return { user, organization };
      });

      const token = signToken(user.id, user.organization_id, user.email);

      console.log(JSON.stringify({
        event: "auth.register",
        userId: user.id,
        organizationId: user.organization_id,
      }));

      res.status(201).json({
        token,
        user: {
          id: user.id,
          email: user.email,
          organizationId: user.organization_id,
          createdAt: user.created_at,
        },
        organization: { id: organization.id, name: organization.name },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/v1/auth/login ────────────────────────────────────────────────────

router.post(
  "/login",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = LoginSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.errors.map((e) => e.message).join(", "),
          code: "VALIDATION_ERROR",
        });
        return;
      }

      const { email, password } = parsed.data;

      const user = await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          password_hash: true,
          organization_id: true,
          created_at: true,
        },
      });

      // Use constant-time comparison path even when user not found (prevent timing attacks).
      const dummyHash = "$2b$12$DUMMY_HASH_FOR_TIMING_SAFE_COMPARE_PLACEHOLDER_ONLY";
      const hashToCheck = user ? user.password_hash : dummyHash;
      const passwordMatch = await bcrypt.compare(password, hashToCheck);

      if (!user || !passwordMatch) {
        res.status(401).json({ error: "Invalid email or password", code: "AUTH_INVALID_CREDENTIALS" });
        return;
      }

      const token = signToken(user.id, user.organization_id, user.email);

      console.log(JSON.stringify({
        event: "auth.login",
        userId: user.id,
        organizationId: user.organization_id,
      }));

      res.status(200).json({
        token,
        user: {
          id: user.id,
          email: user.email,
          organizationId: user.organization_id,
          createdAt: user.created_at,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
