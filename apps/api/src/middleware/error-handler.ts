import type { ErrorRequestHandler } from "express";
import mongoose from "mongoose";
import { AppError } from "../errors/app-error.js";
import { logger } from "../lib/logger.js";

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof AppError) {
    response.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message
      }
    });
    return;
  }

  if (error instanceof mongoose.Error.ValidationError || error instanceof mongoose.Error.CastError) {
    response.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Request data is invalid" }
    });
    return;
  }
  if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
    response.status(409).json({
      error: { code: "CONFLICT", message: "The requested resource already exists" }
    });
    return;
  }

  logger.error({ err: error }, "Unhandled request error");
  response.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred"
    }
  });
};
