import { useQuery } from "@tanstack/react-query";
import ProductInsightsTable from "@/components/ProductInsightsTable";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useLocation } from "wouter";

export default function ProductInsights() {
  const [, setLocation] = useLocation();

  const { data: insights = [], isLoading } = useQuery<any[]>({
    queryKey: ['/api/insights'],
  });

  const { data: categories = [] } = useQuery<any[]>({
    queryKey: ['/api/categories'],
  });

  // Transform data to match component interface
  const tableInsights = (insights as any[]).map((insight: any) => ({
    id: insight.id,
    feature: insight.feature,
    context: insight.context,
    quote: insight.quote,
    company: insight.company,
    category: insight.categoryName || 'NEW',
    categoryId: insight.categoryId || null,
    createdAt: insight.createdAt,
  }));

  // Pass full category objects with id and name
  const categoryObjects = (categories as any[]).map((cat: any) => ({
    id: cat.id,
    name: cat.name,
  }));

  return (
    <div className="container mx-auto py-8 px-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold">Product Insights & Feature Demand</h1>
          <p className="text-muted-foreground mt-1">
            Feature requests and context from BD calls
          </p>
        </div>
        <Button onClick={() => setLocation('/')} data-testid="button-add-transcript">
          <Plus className="w-4 h-4 mr-2" />
          Add Transcript
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading insights...</div>
      ) : (
        <ProductInsightsTable insights={tableInsights} categories={categoryObjects} />
      )}
    </div>
  );
}
