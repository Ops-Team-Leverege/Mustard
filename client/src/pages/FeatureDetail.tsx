import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ExternalLink } from "lucide-react";
import ProductInsightsTable, { ProductInsight } from "@/components/ProductInsightsTable";

type Feature = {
  id: string;
  name: string;
  description: string | null;
  videoLink: string | null;
  helpGuideLink: string | null;
  categoryId: string | null;
  categoryName: string | null;
  createdAt: Date;
};

export default function FeatureDetail() {
  const params = useParams<{ id: string }>();
  const featureId = params.id;

  const { data: feature, isLoading: isLoadingFeature } = useQuery<Feature>({
    queryKey: [`/api/features/${featureId}`],
    enabled: !!featureId,
  });

  const { data: allInsights = [], isLoading: isLoadingInsights } = useQuery<ProductInsight[]>({
    queryKey: ['/api/insights'],
    enabled: !!feature?.categoryId,
  });

  // Filter insights by category
  const insights = allInsights.filter(insight => insight.categoryId === feature?.categoryId);

  if (isLoadingFeature) {
    return (
      <div className="container mx-auto py-8 px-6">
        <div className="text-center py-12 text-muted-foreground">Loading feature...</div>
      </div>
    );
  }

  if (!feature) {
    return (
      <div className="container mx-auto py-8 px-6">
        <div className="text-center py-12 text-muted-foreground">Feature not found</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-6">
      <Link href="/features">
        <Button variant="ghost" className="mb-6" data-testid="button-back-to-features">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Features
        </Button>
      </Link>

      <Card className="mb-8">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <CardTitle className="text-2xl mb-2" data-testid="text-feature-name">
                {feature.name}
              </CardTitle>
              {feature.categoryName && (
                <Badge variant="secondary" className="mb-3" data-testid="badge-category">
                  {feature.categoryName}
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {feature.description && (
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Description</h3>
              <p className="whitespace-pre-wrap" data-testid="text-description">
                {feature.description}
              </p>
            </div>
          )}
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
            {feature.videoLink && (
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">Video Demo</h3>
                <a
                  href={feature.videoLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center text-primary hover:underline"
                  data-testid="link-video"
                >
                  {feature.videoLink}
                  <ExternalLink className="w-3 h-3 ml-1" />
                </a>
              </div>
            )}
            {feature.helpGuideLink && (
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">Help Guide</h3>
                <a
                  href={feature.helpGuideLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center text-primary hover:underline"
                  data-testid="link-help-guide"
                >
                  {feature.helpGuideLink}
                  <ExternalLink className="w-3 h-3 ml-1" />
                </a>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {feature.categoryId && (
        <div>
          <h2 className="text-xl font-semibold mb-4">
            Related Insights from {feature.categoryName}
          </h2>
          {isLoadingInsights ? (
            <div className="text-center py-12 text-muted-foreground">Loading insights...</div>
          ) : insights.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No insights found for this category yet.
            </div>
          ) : (
            <ProductInsightsTable insights={insights} />
          )}
        </div>
      )}

      {!feature.categoryId && (
        <div className="text-center py-12 text-muted-foreground">
          This feature is not linked to a category. Link it to a category to see related insights.
        </div>
      )}
    </div>
  );
}
