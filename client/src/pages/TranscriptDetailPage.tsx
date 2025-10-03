import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Calendar, Building2 } from "lucide-react";
import { format } from "date-fns";
import ProductInsightsTable from "@/components/ProductInsightsTable";
import QATable from "@/components/QATable";
import type { Transcript, ProductInsightWithCategory, QAPairWithCategory, Company } from "@shared/schema";

interface TranscriptDetails {
  transcript: Transcript;
  insights: ProductInsightWithCategory[];
  qaPairs: QAPairWithCategory[];
  company?: Company;
}

export default function TranscriptDetailPage() {
  const params = useParams();
  const transcriptId = params.id;
  const [, navigate] = useLocation();

  const { data, isLoading } = useQuery<TranscriptDetails>({
    queryKey: [`/api/transcripts/${transcriptId}/details`],
    enabled: !!transcriptId,
  });

  const { data: categories = [] } = useQuery<Array<{ id: string; name: string; description?: string }>>({
    queryKey: ['/api/categories'],
  });

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="p-6">
            <p className="text-muted-foreground">Transcript not found</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { transcript, insights, qaPairs, company } = data;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => company ? navigate(`/companies/${company.slug}`) : navigate('/transcripts')}
          data-testid="button-back-to-company"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to {company?.name || 'Transcripts'}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <CardTitle className="text-2xl">
                {transcript.name || "Untitled Transcript"}
              </CardTitle>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                {company && (
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    <span>{company.name}</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  <span>{format(new Date(transcript.createdAt), "MMMM d, yyyy")}</span>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Badge variant="outline" data-testid="badge-insights-count">
                {insights.length} {insights.length === 1 ? 'Insight' : 'Insights'}
              </Badge>
              <Badge variant="outline" data-testid="badge-qa-count">
                {qaPairs.length} Q&A
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium mb-2">Transcript Content</h3>
              <div className="bg-muted/50 rounded-md p-4 max-h-60 overflow-y-auto">
                <p className="text-sm whitespace-pre-wrap" data-testid="transcript-content">
                  {transcript.transcript}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="insights" className="w-full">
        <TabsList data-testid="tabs-transcript-details">
          <TabsTrigger value="insights" data-testid="tab-insights">
            Product Insights ({insights.length})
          </TabsTrigger>
          <TabsTrigger value="qa" data-testid="tab-qa">
            Q&A Pairs ({qaPairs.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="insights" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Product Insights</CardTitle>
              <CardDescription>
                Insights extracted from this transcript
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ProductInsightsTable
                insights={insights.map(i => ({
                  ...i,
                  category: i.categoryName || 'NEW',
                }))}
                categories={categories}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="qa" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Q&A Pairs</CardTitle>
              <CardDescription>
                Questions and answers from this transcript
              </CardDescription>
            </CardHeader>
            <CardContent>
              <QATable
                qaPairs={qaPairs.map(qa => ({
                  ...qa,
                  companyId: qa.companyId || '',
                }))}
                categories={categories}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
