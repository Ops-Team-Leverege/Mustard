import { useQuery } from "@tanstack/react-query";
import ProductInsightsTable from "@/components/ProductInsightsTable";

export default function ProductInsights() {

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
    transcriptDate: insight.transcriptDate,
  }));

  // Pass full category objects with id and name
  const categoryObjects = (categories as any[]).map((cat: any) => ({
    id: cat.id,
    name: cat.name,
  }));

  return (
    <div className="container mx-auto py-8 px-6">
      <div className="mb-6">
        <h1 className="text-3xl font-semibold">Product Insights & Feature Demand</h1>
        <p className="text-muted-foreground mt-1">
          Feature requests and context from BD calls
        </p>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading insights...</div>
      ) : (
        <ProductInsightsTable insights={tableInsights} categories={categoryObjects} />
      )}
    </div>
  );
}
