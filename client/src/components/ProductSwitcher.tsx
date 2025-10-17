import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type Product = "PitCrew" | "AutoTrace" | "WorkWatch";

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
    onSuccess: () => {
      queryClient.invalidateQueries();
      
      toast({
        title: "Product switched",
        description: "All data has been refreshed for the new product.",
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
  const products: Product[] = ["PitCrew", "AutoTrace", "WorkWatch"];

  return (
    <div className="flex items-center gap-1" data-testid="product-switcher">
      {products.map((product) => (
        <Button
          key={product}
          variant={product === currentProduct ? "default" : "ghost"}
          size="sm"
          data-testid={`product-button-${product}`}
          disabled={product === currentProduct || switchProductMutation.isPending}
          onClick={() => {
            if (product !== currentProduct) {
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
