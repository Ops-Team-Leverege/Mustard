import type { Response } from "express";
import { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
  isOperational?: boolean;
}

export class ValidationError extends Error implements AppError {
  statusCode = 400;
  isOperational = true;
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error implements AppError {
  statusCode = 404;
  isOperational = true;
  constructor(resource: string) {
    super(`${resource} not found`);
    this.name = "NotFoundError";
  }
}

export class AuthenticationError extends Error implements AppError {
  statusCode = 401;
  isOperational = true;
  constructor(message = "Authentication required") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends Error implements AppError {
  statusCode = 403;
  isOperational = true;
  constructor(message = "Access denied") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class ExternalServiceError extends Error implements AppError {
  statusCode = 502;
  isOperational = true;
  service: string;
  constructor(service: string, message: string) {
    super(`${service} error: ${message}`);
    this.name = "ExternalServiceError";
    this.service = service;
  }
}

export class RateLimitError extends Error implements AppError {
  statusCode = 429;
  isOperational = true;
  constructor(message = "Rate limit exceeded") {
    super(message);
    this.name = "RateLimitError";
  }
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof ZodError) {
    return fromZodError(error).message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "An unexpected error occurred";
}

export function getErrorStatusCode(error: unknown): number {
  if (error instanceof ZodError) {
    return 400;
  }
  if ((error as AppError)?.statusCode) {
    return (error as AppError).statusCode!;
  }
  return 500;
}

export interface HandleRouteErrorOptions {
  /** Include { success: false } in error response for backwards compatibility with external APIs */
  includeSuccessField?: boolean;
}

export function handleRouteError(
  res: Response,
  error: unknown,
  context?: string,
  options?: HandleRouteErrorOptions,
): void {
  const statusCode = getErrorStatusCode(error);
  const message = getErrorMessage(error);
  
  if (statusCode >= 500 && context) {
    console.error(`[${context}] Error:`, error);
  }
  
  if (options?.includeSuccessField) {
    res.status(statusCode).json({ success: false, error: message });
  } else {
    res.status(statusCode).json({ error: message });
  }
}

export function logError(context: string, error: unknown): void {
  const message = getErrorMessage(error);
  const stack = error instanceof Error ? error.stack : undefined;
  console.error(`[${context}] ${message}`, stack ? `\n${stack}` : "");
}

export interface ClassifiedError {
  type: string;
  userMessage: string;
  errorMessage: string;
  errorCode: string | number | undefined;
  stack: string | undefined;
}

export function classifyPipelineError(err: unknown): ClassifiedError {
  const errorMessage = err instanceof Error ? err.message : String(err);
  const errorCode = (err as AppError)?.code || (err as AppError)?.statusCode;
  const stack = err instanceof Error ? err.stack : undefined;

  if (errorCode === 'insufficient_quota' || errorCode === 429 ||
    errorMessage.includes('exceeded your current quota') ||
    errorMessage.includes('rate limit')) {
    return {
      type: "openai_quota",
      userMessage: "I can't process this right now — the AI service quota has been exceeded. Please contact an admin to check the OpenAI billing settings.",
      errorMessage, errorCode, stack,
    };
  }

  if (errorCode === 401 || errorMessage.includes('Incorrect API key') ||
    errorMessage.includes('invalid_api_key')) {
    return {
      type: "openai_auth",
      userMessage: "I can't process this right now — there's an issue with the AI service configuration. Please contact an admin.",
      errorMessage, errorCode, stack,
    };
  }

  return {
    type: "internal",
    userMessage: "Sorry — I hit an internal error while processing that request.",
    errorMessage, errorCode, stack,
  };
}
