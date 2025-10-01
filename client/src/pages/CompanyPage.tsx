import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import ProductInsightsTable from "@/components/ProductInsightsTable";
import QATable from "@/components/QATable";
import { Badge } from "@/components/ui/badge";
import type { CompanyOverview } from "@shared/schema";

export default function CompanyPage() {
  const params = useParams();
  const companySlug = params.slug;

  const { data: overview, isLoading } = useQuery<CompanyOverview>({
    queryKey: [`/api/companies/${companySlug}/overview`],
    enabled: !!companySlug,
  });

  const { data: categories = [] } = useQuery<Array<{ id: string; name: string; description?: string }>>({
    queryKey: ['/api/categories'],
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Company Not Found</CardTitle>
            <CardDescription>The requested company does not exist.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const latestTranscript = overview.transcripts?.length > 0 
    ? overview.transcripts.sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )[0]
    : null;

  return (
    <div className="p-6 space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex-1">
              <CardTitle className="text-3xl">{overview.company.name}</CardTitle>
              {overview.company.notes && (
                <CardDescription className="mt-2">{overview.company.notes}</CardDescription>
              )}
            </div>
            <div className="flex gap-2 items-center flex-wrap">
              <Badge variant="secondary" data-testid="badge-transcript-count">
                {overview.transcriptCount} {overview.transcriptCount === 1 ? 'Transcript' : 'Transcripts'}
              </Badge>
              <Badge variant="secondary" data-testid="badge-insight-count">
                {overview.insightCount} {overview.insightCount === 1 ? 'Insight' : 'Insights'}
              </Badge>
              <Badge variant="secondary" data-testid="badge-qa-count">
                {overview.qaCount} Q&A {overview.qaCount === 1 ? 'Pair' : 'Pairs'}
              </Badge>
            </div>
          </div>
        </CardHeader>
        {latestTranscript && (latestTranscript.companyDescription || latestTranscript.mainInterestAreas) && (
          <CardContent className="space-y-4">
            {latestTranscript.companyDescription && (
              <div>
                <h3 className="text-sm font-semibold mb-1">Company Description</h3>
                <p className="text-sm text-muted-foreground">{latestTranscript.companyDescription}</p>
              </div>
            )}
            {latestTranscript.mainInterestAreas && (
              <div>
                <h3 className="text-sm font-semibold mb-1">Main Interest Areas</h3>
                <p className="text-sm text-muted-foreground">{latestTranscript.mainInterestAreas}</p>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Product Insights</CardTitle>
          <CardDescription>
            Feature requests and product feedback from {overview.company.name}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProductInsightsTable 
            insights={overview.insights.map(i => ({
              ...i,
              category: i.categoryName || 'NEW',
            }))}
            categories={categories}
            defaultCompany={overview.company.name}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Q&A Pairs</CardTitle>
          <CardDescription>
            Questions and answers from {overview.company.name} calls
          </CardDescription>
        </CardHeader>
        <CardContent>
          <QATable 
            qaPairs={overview.qaPairs.map(qa => ({
              ...qa,
              category: qa.categoryName || 'NEW',
            }))}
            categories={categories}
            defaultCompany={overview.company.name}
          />
        </CardContent>
      </Card>
    </div>
  );
}
