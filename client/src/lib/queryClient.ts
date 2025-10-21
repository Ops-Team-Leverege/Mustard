import { QueryClient, QueryFunction, QueryCache, MutationCache } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = await res.text();
    let cleanMessage = '';
    
    // Try to parse JSON error response
    try {
      const errorData = JSON.parse(text);
      
      // Extract clean error message from various formats
      if (errorData.error) {
        // Handle { error: "message" } or { error: { message: "..." } }
        if (typeof errorData.error === 'string') {
          cleanMessage = errorData.error;
        } else if (Array.isArray(errorData.error)) {
          // Handle Zod validation errors: { error: [{ message: "..." }, ...] }
          cleanMessage = errorData.error.map((e: any) => e.message || JSON.stringify(e)).join(', ');
        } else if (errorData.error.message) {
          cleanMessage = errorData.error.message;
        } else {
          // Fallback for complex error objects
          cleanMessage = JSON.stringify(errorData.error);
        }
      } else if (errorData.message) {
        // Handle { message: "..." }
        cleanMessage = errorData.message;
      }
    } catch (e) {
      // If JSON parsing fails, use the raw text
      if (e instanceof SyntaxError) {
        cleanMessage = text || res.statusText;
      } else {
        // Re-throw unexpected errors
        throw e;
      }
    }
    
    // Always include status code for auth detection logic (401 checks)
    const finalMessage = cleanMessage || res.statusText || 'Request failed';
    throw new Error(`${res.status}: ${finalMessage}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (error instanceof Error && error.message.includes('401')) {
        queryClient.clear();
        window.location.href = '/api/logout';
      }
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      if (error instanceof Error && error.message.includes('401')) {
        queryClient.clear();
        window.location.href = '/api/logout';
      }
    },
  }),
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: true,
      staleTime: 60000, // 60 seconds - data is fresh for 1 minute
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
