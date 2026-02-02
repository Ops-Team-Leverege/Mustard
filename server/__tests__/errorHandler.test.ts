import { describe, it, expect, vi } from "vitest";
import { 
  ValidationError, 
  NotFoundError, 
  AuthenticationError,
  AuthorizationError,
  ExternalServiceError,
  RateLimitError,
  getErrorMessage, 
  getErrorStatusCode,
  handleRouteError 
} from "../utils/errorHandler";
import { z } from "zod";

describe("Error Classes", () => {
  it("ValidationError has 400 status code", () => {
    const error = new ValidationError("Invalid input");
    expect(error.statusCode).toBe(400);
    expect(error.message).toBe("Invalid input");
    expect(error.name).toBe("ValidationError");
    expect(error.isOperational).toBe(true);
  });

  it("NotFoundError has 404 status code", () => {
    const error = new NotFoundError("Transcript");
    expect(error.statusCode).toBe(404);
    expect(error.message).toBe("Transcript not found");
    expect(error.name).toBe("NotFoundError");
  });

  it("AuthenticationError has 401 status code", () => {
    const error = new AuthenticationError();
    expect(error.statusCode).toBe(401);
    expect(error.message).toBe("Authentication required");
  });

  it("AuthenticationError accepts custom message", () => {
    const error = new AuthenticationError("Invalid token");
    expect(error.message).toBe("Invalid token");
  });

  it("AuthorizationError has 403 status code", () => {
    const error = new AuthorizationError();
    expect(error.statusCode).toBe(403);
    expect(error.message).toBe("Access denied");
  });

  it("ExternalServiceError has 502 status code", () => {
    const error = new ExternalServiceError("OpenAI", "Rate limit exceeded");
    expect(error.statusCode).toBe(502);
    expect(error.message).toBe("OpenAI error: Rate limit exceeded");
    expect(error.service).toBe("OpenAI");
  });

  it("RateLimitError has 429 status code", () => {
    const error = new RateLimitError();
    expect(error.statusCode).toBe(429);
    expect(error.message).toBe("Rate limit exceeded");
  });
});

describe("getErrorMessage", () => {
  it("extracts message from ZodError", () => {
    const schema = z.object({ name: z.string() });
    try {
      schema.parse({ name: 123 });
    } catch (error) {
      const message = getErrorMessage(error);
      expect(message).toContain("Expected string, received number");
    }
  });

  it("extracts message from standard Error", () => {
    const error = new Error("Something went wrong");
    expect(getErrorMessage(error)).toBe("Something went wrong");
  });

  it("returns default message for unknown error types", () => {
    expect(getErrorMessage("string error")).toBe("An unexpected error occurred");
    expect(getErrorMessage(null)).toBe("An unexpected error occurred");
    expect(getErrorMessage(undefined)).toBe("An unexpected error occurred");
    expect(getErrorMessage(42)).toBe("An unexpected error occurred");
  });
});

describe("getErrorStatusCode", () => {
  it("returns 400 for ZodError", () => {
    const schema = z.object({ name: z.string() });
    try {
      schema.parse({});
    } catch (error) {
      expect(getErrorStatusCode(error)).toBe(400);
    }
  });

  it("returns custom statusCode from AppError", () => {
    expect(getErrorStatusCode(new NotFoundError("X"))).toBe(404);
    expect(getErrorStatusCode(new ValidationError("X"))).toBe(400);
    expect(getErrorStatusCode(new AuthorizationError())).toBe(403);
    expect(getErrorStatusCode(new RateLimitError())).toBe(429);
  });

  it("returns 500 for standard Error", () => {
    expect(getErrorStatusCode(new Error("oops"))).toBe(500);
  });

  it("returns 500 for unknown types", () => {
    expect(getErrorStatusCode("string")).toBe(500);
    expect(getErrorStatusCode(null)).toBe(500);
  });
});

describe("handleRouteError", () => {
  it("sends correct status and message for NotFoundError", () => {
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    
    handleRouteError(mockRes as any, new NotFoundError("User"), "test");
    
    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockRes.json).toHaveBeenCalledWith({ error: "User not found" });
  });

  it("sends 400 for ValidationError", () => {
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    
    handleRouteError(mockRes as any, new ValidationError("Bad data"), "test");
    
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({ error: "Bad data" });
  });

  it("sends 500 for standard Error", () => {
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    
    handleRouteError(mockRes as any, new Error("Internal"), "test");
    
    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith({ error: "Internal" });
  });

  it("logs errors for 500+ status codes when context provided", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    
    handleRouteError(mockRes as any, new Error("Server error"), "TestContext");
    
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("does not log for client errors", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    
    handleRouteError(mockRes as any, new NotFoundError("Item"), "TestContext");
    
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
