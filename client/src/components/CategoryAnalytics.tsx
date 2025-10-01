import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart3, TrendingUp } from "lucide-react";

export interface Category {
  id: string;
  name: string;
  description?: string | null;
  usageCount: number;
}

interface CategoryAnalyticsProps {
  categories: Category[];
}

export default function CategoryAnalytics({ categories }: CategoryAnalyticsProps) {
  const totalInsights = categories.reduce((sum, cat) => sum + cat.usageCount, 0);
  const topCategories = [...categories]
    .sort((a, b) => b.usageCount - a.usageCount)
    .slice(0, 5);
  
  const maxUsage = topCategories[0]?.usageCount || 1;

  return (
    <div className="space-y-4 mb-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Categories</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-categories">{categories.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Active categories
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Insights</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-insights">{totalInsights}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Across all categories
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Most Popular</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold truncate" data-testid="text-top-category">
              {topCategories[0]?.name || 'N/A'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {topCategories[0]?.usageCount || 0} insights
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top Categories</CardTitle>
          <CardDescription>Most talked about categories by insight count</CardDescription>
        </CardHeader>
        <CardContent>
          {topCategories.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No categories yet</p>
          ) : (
            <div className="space-y-3">
              {topCategories.map((category, index) => {
                const percentage = totalInsights > 0 ? (category.usageCount / totalInsights) * 100 : 0;
                const barWidth = maxUsage > 0 ? (category.usageCount / maxUsage) * 100 : 0;
                
                return (
                  <div key={category.id} className="space-y-1" data-testid={`analytics-category-${category.id}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Badge variant="outline" className="font-normal text-xs">
                          #{index + 1}
                        </Badge>
                        <span className="text-sm font-medium truncate">{category.name}</span>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className="text-xs text-muted-foreground">
                          {percentage.toFixed(1)}%
                        </span>
                        <Badge variant="secondary" className="font-normal text-xs">
                          {category.usageCount}
                        </Badge>
                      </div>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-primary transition-all duration-500"
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
