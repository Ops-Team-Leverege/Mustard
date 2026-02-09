/**
 * Security Middleware
 * 
 * Provides CSRF protection and security headers for the application.
 * Implements layered security approach suitable for internal business tools.
 */

import { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../utils/errorHandler';
import { AUTH_CONSTANTS, RATE_LIMIT_CONSTANTS } from '../config/constants';

/**
 * Enhanced cookie configuration with SameSite protection.
 * This prevents cross-site request forgery by restricting cookie sending.
 */
export function getSecureCookieConfig() {
    const sessionTtl = AUTH_CONSTANTS.SESSION_TTL_MS;

    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict' as const, // Prevents cross-site cookie sending
        maxAge: sessionTtl,
    };
}

/**
 * Origin validation middleware.
 * Validates that requests come from expected origins.
 */
export function validateOrigin(req: Request, res: Response, next: NextFunction) {
    // Skip validation for GET requests (they don't change state)
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
        return next();
    }

    // Skip validation for Slack webhooks (they have signature verification)
    if (req.path.startsWith('/api/slack/')) {
        return next();
    }

    // Skip validation for external API (they use API keys)
    if (req.path.startsWith('/api/external/')) {
        return next();
    }

    const origin = req.get('Origin') || req.get('Referer');
    const host = req.get('Host');

    if (!origin) {
        // Allow requests without Origin/Referer for same-origin requests
        // (some browsers don't send these headers for same-origin requests)
        return next();
    }

    try {
        const originUrl = new URL(origin);
        const expectedHosts = process.env.REPLIT_DOMAINS?.split(',') || [];

        // Check if origin matches expected domains
        const isValidOrigin = expectedHosts.some(domain =>
            originUrl.hostname === domain ||
            originUrl.hostname === host
        );

        if (!isValidOrigin) {
            console.warn(`[Security] Invalid origin: ${origin} for host: ${host}`);
            throw new ValidationError('Invalid request origin');
        }

        next();
    } catch (error) {
        if (error instanceof ValidationError) {
            throw error;
        }
        console.warn(`[Security] Origin validation error:`, error);
        throw new ValidationError('Invalid request origin');
    }
}

/**
 * Security headers middleware.
 * Adds essential security headers to all responses.
 */
export function addSecurityHeaders(req: Request, res: Response, next: NextFunction) {
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY');

    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Enable XSS protection
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // Referrer policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Content Security Policy (basic)
    const csp = [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Needed for Vite in dev
        "style-src 'self' 'unsafe-inline'", // Needed for CSS
        "img-src 'self' data: https:",
        "connect-src 'self' https:",
        "font-src 'self' https:",
    ].join('; ');

    res.setHeader('Content-Security-Policy', csp);

    next();
}

/**
 * Rate limiting for authentication endpoints.
 * Prevents brute force attacks on login.
 */
const authAttempts = new Map<string, { count: number; resetTime: number }>();

export function authRateLimit(req: Request, res: Response, next: NextFunction) {
    const clientId = req.ip || 'unknown';
    const now = Date.now();
    const windowMs = RATE_LIMIT_CONSTANTS.AUTH_WINDOW_MS;
    const maxAttempts = RATE_LIMIT_CONSTANTS.AUTH_MAX_ATTEMPTS;

    const clientData = authAttempts.get(clientId);

    if (!clientData || now > clientData.resetTime) {
        authAttempts.set(clientId, { count: 1, resetTime: now + windowMs });
        return next();
    }

    if (clientData.count >= maxAttempts) {
        const retryAfter = Math.ceil((clientData.resetTime - now) / 1000);
        res.set('Retry-After', retryAfter.toString());
        return res.status(429).json({
            error: 'Too many authentication attempts',
            retryAfter
        });
    }

    clientData.count++;
    next();
}

/**
 * Simple CSRF token implementation (optional - for maximum security).
 * Generates and validates CSRF tokens for state-changing operations.
 */
export function generateCSRFToken(): string {
    return require('crypto').randomBytes(32).toString('hex');
}

export function validateCSRFToken(req: Request, res: Response, next: NextFunction) {
    // Skip for GET requests
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
        return next();
    }

    // Skip for API key authenticated requests
    if (req.headers['x-api-key']) {
        return next();
    }

    // Skip for Slack webhooks (signature verified)
    if (req.path.startsWith('/api/slack/')) {
        return next();
    }

    const tokenFromHeader = req.get('X-CSRF-Token');
    const tokenFromBody = req.body?.csrfToken;
    const sessionToken = (req.session as any)?.csrfToken;

    const providedToken = tokenFromHeader || tokenFromBody;

    if (!providedToken || !sessionToken || providedToken !== sessionToken) {
        throw new ValidationError('Invalid CSRF token');
    }

    next();
}

/**
 * Middleware to add CSRF token to session and response.
 */
export function setupCSRFToken(req: Request, res: Response, next: NextFunction) {
    if (!req.session) {
        return next();
    }

    // Generate token if not exists
    if (!(req.session as any).csrfToken) {
        (req.session as any).csrfToken = generateCSRFToken();
    }

    // Add token to response headers for client access
    res.setHeader('X-CSRF-Token', (req.session as any).csrfToken);

    next();
}