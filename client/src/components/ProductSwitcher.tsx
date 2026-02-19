import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import type { Product } from "@shared/schema";
import { PRODUCTS } from "@shared/schema";

interface User {
  id: string;
  email: string | null;
  currentProduct: Product;
}

export default function ProductSwitcher() {
  const { toast } = useToast();

  const { data: user, isLoading } = useQuery<User>({
    queryKey: ["/api/auth/user"],
  });

  const switchProductMutation = useMutation({
    mutationFn: async (product: Product) => {
      const res = await apiRequest("PUT", "/api/user/product", { product });
      return res.json();
    },
    onSuccess: (data, product) => {
      queryClient.invalidateQueries();

      // Dynamic message based on what you're viewing
      const contextMessages: Record<Product, string> = {
        PitCrew: "You're now viewing tire and automotive service insights.",
        AutoTrace: "You're now viewing vehicle tracking and fleet management data.",
        WorkWatch: "You're now viewing workforce management insights.",
        ExpressLane: "You're now viewing quick service operations data.",
        Partnerships: "You're now viewing strategic partnership meetings and discussions.",
      };

      toast({
        title: `Switched to ${product}`,
        description: contextMessages[product] || `All data has been refreshed for ${product}.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to switch product",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (isLoading || !user) {
    return (
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" disabled>
          Loading...
        </Button>
      </div>
    );
  }

  const currentProduct = user.currentProduct || "PitCrew";
  const products = [...PRODUCTS];

  return (
    <div className="flex items-center gap-1" data-testid="product-switcher">
      {switchProductMutation.isPending && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground mr-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Switching...</span>
        </div>
      )}
      {products.map((product) => (
        <Button
          key={product}
          variant={product === currentProduct ? "default" : "ghost"}
          size="sm"
          className={product === currentProduct ? "text-white" : ""}
          data-testid={`product-button-${product}`}
          disabled={switchProductMutation.isPending}
          onClick={() => {
            if (product !== currentProduct && !switchProductMutation.isPending) {
              switchProductMutation.mutate(product);
            }
          }}
        >
          {product}
        </Button>
      ))}
    </div>
  );
}
