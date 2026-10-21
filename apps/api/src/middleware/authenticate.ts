import type { Request, RequestHandler } from "express";
import { AppError } from "../errors/app-error.js";
import { Session, User } from "../models/index.js";
import { findSessionByToken } from "../services/identity-service.js";
import { sessionCookieName } from "../security/cookies.js";

export interface AuthenticatedRequest extends Request {
  auth?: {
    userId: string;
    sessionId: string;
  };
}

export const requireAuthentication: RequestHandler = async (request, _response, next) => {
  try {
    const token = request.cookies?.[sessionCookieName];
    if (!token || typeof token !== "string") {
      throw new AppError("Authentication required", 401, "UNAUTHENTICATED");
    }
    const session = await findSessionByToken(token);
    if (!session) throw new AppError("Authentication required", 401, "UNAUTHENTICATED");
    const user = await User.findOne({ _id: session.userId, accountStatus: "active" }).select("_id");
    if (!user) {
      await Session.updateOne({ _id: session._id }, { $set: { revokedAt: new Date() } });
      throw new AppError("Authentication required", 401, "UNAUTHENTICATED");
    }
    (request as AuthenticatedRequest).auth = {
      userId: user._id.toString(),
      sessionId: session._id.toString()
    };
    next();
  } catch (error) {
    next(error);
  }
};

export function actorFromRequest(request: Request) {
  const auth = (request as AuthenticatedRequest).auth;
  if (!auth) throw new AppError("Authentication required", 401, "UNAUTHENTICATED");
  return { userId: auth.userId };
}
