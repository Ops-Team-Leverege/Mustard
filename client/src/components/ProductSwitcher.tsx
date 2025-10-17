import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
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
      <Button variant="ghost" size="sm" disabled data-testid="button-product-switcher">
        Loading...
      </Button>
    );
  }

  const currentProduct = user.currentProduct || "PitCrew";
  const products: Product[] = ["PitCrew", "AutoTrace", "WorkWatch"];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="ghost" 
          size="sm" 
          className="gap-1"
          data-testid="button-product-switcher"
        >
          {currentProduct}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {products.map((product) => (
          <DropdownMenuItem
            key={product}
            data-testid={`product-option-${product}`}
            className="cursor-pointer"
            disabled={product === currentProduct || switchProductMutation.isPending}
            onSelect={() => {
              if (product !== currentProduct) {
                switchProductMutation.mutate(product);
              }
            }}
          >
            {product}
            {product === currentProduct && " (current)"}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
