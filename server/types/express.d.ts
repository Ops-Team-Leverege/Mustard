import "express-session";

declare module "express-session" {
  interface SessionData {
    csrfToken?: string;
  }
}

interface OIDCUser {
  claims?: {
    sub: string;
    email?: string;
    first_name?: string;
    last_name?: string;
    profile_image_url?: string;
    exp?: number;
  };
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
}

declare global {
  namespace Express {
    interface User extends OIDCUser {}
  }
}
