import { describe, it, expect, vi, beforeEach } from "vitest";
import { Request, Response, NextFunction } from "express";
import {
    validateOrigin,
    addSecurityHeaders,
    authRateLimit,
    getSecureCookieConfig
} from "../middleware/security";
import { ValidationError } from "../utils/errorHandler";

// Mock environment variables
vi.mock('process', () => ({
    env: {
        REPLIT_DOMAINS: 'test-domain.replit.dev,custom-domain.com',
        NODE_ENV: 'test'
    }
}));

describe("Security Middleware", () => {
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let mockNext: NextFunction;

    beforeEach(() => {
        mockReq = {
            method: 'POST',
            path: '/api/test',
            get: vi.fn(),
        };
        mockRes = {
            setHeader: vi.fn(),
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
            set: vi.fn(),
        };
        mockNext = vi.fn();
    });

    describe("validateOrigin", () => {
        it("should allow GET requests without validation", () => {
            mockReq.method = 'GET';

            validateOrigin(mockReq as Request, mockRes as Response, mockNext);

            expect(mockNext).toHaveBeenCalled();
        });

        it("should skip validation for Slack webhooks", () => {
            mockReq.path = '/api/slack/events';

            validateOrigin(mockReq as Request, mockRes as Response, mockNext);

            expect(mockNext).toHaveBeenCalled();
        });

        it("should skip validation for external API endpoints", () => {
            mockReq.path = '/api/external/transcripts';

            validateOrigin(mockReq as Request, mockRes as Response, mockNext);

            expect(mockNext).toHaveBeenCalled();
        });

        it("should allow requests without Origin header", () => {
            (mockReq.get as any).mockReturnValue(undefined);

            validateOrigin(mockReq as Request, mockRes as Response, mockNext);

            expect(mockNext).toHaveBeenCalled();
        });

        it("should allow requests from valid origins", () => {
            (mockReq.get as any).mockImplementation((header: string) => {
                if (header === 'Origin') return 'https://test-domain.replit.dev';
                if (header === 'Host') return 'test-domain.replit.dev';
                return undefined;
            });

            validateOrigin(mockReq as Request, mockRes as Response, mockNext);

            expect(mockNext).toHaveBeenCalled();
        });

        it("should reject requests from invalid origins", () => {
            (mockReq.get as any).mockImplementation((header: string) => {
                if (header === 'Origin') return 'https://malicious-site.com';
                if (header === 'Host') return 'test-domain.replit.dev';
                return undefined;
            });

            expect(() => {
                validateOrigin(mockReq as Request, mockRes as Response, mockNext);
            }).toThrow(ValidationError);
        });

        it("should handle Referer header when Origin is not present", () => {
            (mockReq.get as any).mockImplementation((header: string) => {
                if (header === 'Origin') return undefined;
                if (header === 'Referer') return 'https://custom-domain.com/page';
                if (header === 'Host') return 'custom-domain.com';
                return undefined;
            });

            validateOrigin(mockReq as Request, mockRes as Response, mockNext);

            expect(mockNext).toHaveBeenCalled();
        });
    });

    describe("addSecurityHeaders", () => {
        it("should add all required security headers", () => {
            addSecurityHeaders(mockReq as Request, mockRes as Response, mockNext);

            expect(mockRes.setHeader).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
            expect(mockRes.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
            expect(mockRes.setHeader).toHaveBeenCalledWith('X-XSS-Protection', '1; mode=block');
            expect(mockRes.setHeader).toHaveBeenCalledWith('Referrer-Policy', 'strict-origin-when-cross-origin');
            expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Security-Policy', expect.stringContaining("default-src 'self'"));
            expect(mockNext).toHaveBeenCalled();
        });
    });

    describe("authRateLimit", () => {
        beforeEach(() => {
            // Clear rate limit cache between tests
            const authAttempts = require('../middleware/security').authAttempts;
            if (authAttempts) {
                authAttempts.clear();
            }
        });

        it("should allow first request", () => {
            mockReq.ip = '127.0.0.1';

            authRateLimit(mockReq as Request, mockRes as Response, mockNext);

            expect(mockNext).toHaveBeenCalled();
        });

        it("should allow requests within limit", () => {
            mockReq.ip = '127.0.0.1';

            // Make 5 requests
            for (let i = 0; i < 5; i++) {
                authRateLimit(mockReq as Request, mockRes as Response, mockNext);
            }

            expect(mockNext).toHaveBeenCalledTimes(5);
        });

        it("should block requests exceeding limit", () => {
            mockReq.ip = '127.0.0.1';

            // Make 11 requests (limit is 10)
            for (let i = 0; i < 11; i++) {
                authRateLimit(mockReq as Request, mockRes as Response, mockNext);
            }

            expect(mockRes.status).toHaveBeenCalledWith(429);
            expect(mockRes.json).toHaveBeenCalledWith({
                error: 'Too many authentication attempts',
                retryAfter: expect.any(Number)
            });
        });

        it("should reset counter after time window", () => {
            mockReq.ip = '127.0.0.1';

            // Mock Date.now to simulate time passage
            const originalNow = Date.now;
            let currentTime = originalNow();
            Date.now = vi.fn(() => currentTime);

            // Make 10 requests
            for (let i = 0; i < 10; i++) {
                authRateLimit(mockReq as Request, mockRes as Response, mockNext);
            }

            // Advance time by 16 minutes (past the 15-minute window)
            currentTime += 16 * 60 * 1000;

            // Should allow new request
            authRateLimit(mockReq as Request, mockRes as Response, mockNext);

            expect(mockNext).toHaveBeenCalledTimes(11);

            // Restore Date.now
            Date.now = originalNow;
        });
    });

    describe("getSecureCookieConfig", () => {
        it("should return secure cookie configuration", () => {
            const config = getSecureCookieConfig();

            expect(config).toEqual({
                httpOnly: true,
                secure: false, // false in test environment
                sameSite: 'strict',
                maxAge: 7 * 24 * 60 * 60 * 1000, // 1 week
            });
        });

        it("should set secure: true in production", () => {
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';

            const config = getSecureCookieConfig();

            expect(config.secure).toBe(true);

            process.env.NODE_ENV = originalEnv;
        });
    });
});