// From Replit Auth integration (blueprint:javascript_log_in_with_replit)
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";

export function useAuth() {
  const { data: user, isLoading, error } = useQuery({
    queryKey: ["/api/auth/user"],
    retry: false,
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    error,
  };
}
