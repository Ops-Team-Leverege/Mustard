import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import CategoryManager, { Category } from "@/components/CategoryManager";
import CategoryAnalytics from "@/components/CategoryAnalytics";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Search, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { Product } from "@shared/schema";

interface User {
  id: string;
  email: string | null;
  currentProduct: Product;
}

export default function Categories() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');

  /**
   * Empty State for Partnerships (Task 7.2)
   * 
   * Check if current product is Partnerships and show appropriate message.
   * Categories are not applicable to Partnerships product.
   */
  const { data: user } = useQuery<User>({
    queryKey: ["/api/auth/user"],
  });

  const isPartnerships = user?.currentProduct === "Partnerships";

  const { data: categories = [], isLoading } = useQuery<Category[]>({
    queryKey: ['/api/categories'],
  });

  const addMutation = useMutation({
    mutationFn: async ({ name, description }: { name: string; description?: string }) => {
      const res = await apiRequest('POST', '/api/categories', { name, description });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/categories'] });
      toast({
        title: "Category Added",
        description: "The category has been created successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Add Category",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, name, description }: { id: string; name: string; description?: string }) => {
      const res = await apiRequest('PATCH', `/api/categories/${id}`, { name, description });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/categories'] });
      toast({
        title: "Category Updated",
        description: "The category has been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Update Category",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('DELETE', `/api/categories/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/categories'] });
      queryClient.invalidateQueries({ queryKey: ['/api/insights'] });
      toast({
        title: "Category Deleted",
        description: "The category has been deleted. Insights have been updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Delete Category",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleAdd = (name: string, description?: string) => {
    addMutation.mutate({ name, description });
  };

  const handleEdit = (id: string, name: string, description?: string) => {
    editMutation.mutate({ id, name, description });
  };

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id);
  };

  if (isLoading) {
    return (
      <div className="container mx-auto py-6 sm:py-8 px-4 sm:px-6">
        <div className="text-center py-12 text-muted-foreground">Loading categories...</div>
      </div>
    );
  }

  /**
   * Empty State for Partnerships (Task 7.2)
   * 
   * Show informative message when Categories page is accessed under Partnerships product.
   */
  if (isPartnerships) {
    return (
      <div className="container mx-auto py-6 sm:py-8 px-4 sm:px-6">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Not Available for Partnerships</AlertTitle>
          <AlertDescription>
            Categories are not applicable to the Partnerships product. This feature is designed for product-specific insights and is only available for PitCrew, AutoTrace, WorkWatch, and ExpressLane.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const filteredCategories = categories.filter(cat =>
    cat.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (cat.description && cat.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="container mx-auto py-6 sm:py-8 px-4 sm:px-6">
      <CategoryAnalytics categories={categories} />

      <div className="mb-4 sm:mb-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search categories by name or description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-categories"
          />
        </div>
      </div>
      <CategoryManager
        categories={filteredCategories}
        onAdd={handleAdd}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />
    </div>
  );
}
