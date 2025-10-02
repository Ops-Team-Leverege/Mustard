import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart3, TrendingUp } from "lucide-react";
import { Link } from "wouter";

export interface Category {
  id: string;
  name: string;
  description?: string | null;
  usageCount: number;
  qaCount: number;
}

interface CategoryAnalyticsProps {
  categories: Category[];
}

export default function CategoryAnalytics({ categories }: CategoryAnalyticsProps) {
  const totalInsights = categories.reduce((sum, cat) => sum + cat.usageCount, 0);
  const totalQAs = categories.reduce((sum, cat) => sum + cat.qaCount, 0);
  
  const topCategoriesByInsight = [...categories]
    .sort((a, b) => b.usageCount - a.usageCount)
    .slice(0, 5);
  
  const topCategoriesByQA = [...categories]
    .sort((a, b) => b.qaCount - a.qaCount)
    .slice(0, 5);
  
  const maxInsightUsage = topCategoriesByInsight[0]?.usageCount || 1;
  const maxQAUsage = topCategoriesByQA[0]?.qaCount || 1;

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
              {topCategoriesByInsight[0]?.name || 'N/A'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {topCategoriesByInsight[0]?.usageCount || 0} insights
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Categories by Insights</CardTitle>
            <CardDescription>Most talked about categories by insight count</CardDescription>
          </CardHeader>
          <CardContent>
            {topCategoriesByInsight.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No categories yet</p>
            ) : (
              <div className="space-y-3">
                {topCategoriesByInsight.map((category, index) => {
                  const percentage = totalInsights > 0 ? (category.usageCount / totalInsights) * 100 : 0;
                  const barWidth = maxInsightUsage > 0 ? (category.usageCount / maxInsightUsage) * 100 : 0;
                  
                  return (
                    <div key={category.id} className="space-y-1" data-testid={`analytics-insight-category-${category.id}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <Badge variant="outline" className="font-normal text-xs">
                            #{index + 1}
                          </Badge>
                          <Link href={`/categories/${category.id}`}>
                            <span className="text-sm font-medium truncate hover:underline cursor-pointer" data-testid={`link-category-${category.id}`}>
                              {category.name}
                            </span>
                          </Link>
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

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Categories by Q&A Pairs</CardTitle>
            <CardDescription>Most talked about categories by Q&A count</CardDescription>
          </CardHeader>
          <CardContent>
            {topCategoriesByQA.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No categories yet</p>
            ) : (
              <div className="space-y-3">
                {topCategoriesByQA.map((category, index) => {
                  const percentage = totalQAs > 0 ? (category.qaCount / totalQAs) * 100 : 0;
                  const barWidth = maxQAUsage > 0 ? (category.qaCount / maxQAUsage) * 100 : 0;
                  
                  return (
                    <div key={category.id} className="space-y-1" data-testid={`analytics-qa-category-${category.id}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <Badge variant="outline" className="font-normal text-xs">
                            #{index + 1}
                          </Badge>
                          <Link href={`/categories/${category.id}`}>
                            <span className="text-sm font-medium truncate hover:underline cursor-pointer" data-testid={`link-qa-category-${category.id}`}>
                              {category.name}
                            </span>
                          </Link>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <span className="text-xs text-muted-foreground">
                            {percentage.toFixed(1)}%
                          </span>
                          <Badge variant="secondary" className="font-normal text-xs">
                            {category.qaCount}
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
    </div>
  );
}
