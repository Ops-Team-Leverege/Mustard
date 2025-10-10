import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Rocket, Calendar } from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";
import ProductInsightsTable from "@/components/ProductInsightsTable";
import QATable from "@/components/QATable";

interface RecentTranscript {
  id: string;
  name: string | null;
  companyName: string;
  createdAt: Date;
}

interface RecentFeature {
  id: string;
  name: string;
  description: string | null;
  releaseDate: Date;
}

interface ProductInsight {
  id: string;
  feature: string;
  context: string;
  quote: string;
  company: string;
  categoryName: string | null;
  categoryId: string | null;
  createdAt: Date;
  transcriptDate: Date | null;
}

interface QAPair {
  id: string;
  question: string;
  answer: string;
  asker: string;
  contactId?: string | null;
  contactName?: string | null;
  contactJobTitle?: string | null;
  company: string;
  companyId: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  isStarred?: string;
  createdAt?: Date | string | null;
  transcriptDate?: Date | string | null;
}

interface Category {
  id: string;
  name: string;
}

interface Feature {
  id: string;
  name: string;
  description: string | null;
  releaseDate: Date | null;
}

export default function Latest() {
  const { data: recentTranscripts = [] } = useQuery<RecentTranscript[]>({
    queryKey: ['/api/dashboard/recent-transcripts'],
  });

  const { data: features = [] } = useQuery<Feature[]>({
    queryKey: ['/api/features'],
  });

  const { data: insights = [] } = useQuery<ProductInsight[]>({
    queryKey: ['/api/insights'],
  });

  const { data: qaPairs = [] } = useQuery<QAPair[]>({
    queryKey: ['/api/qa-pairs'],
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['/api/categories'],
  });

  // Filter features released in the last 7 days
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const recentFeatures: RecentFeature[] = features
    .filter((feature) => {
      if (!feature.releaseDate) return false;
      const releaseDate = new Date(feature.releaseDate);
      return releaseDate >= sevenDaysAgo && releaseDate <= new Date();
    })
    .map(f => ({
      id: f.id,
      name: f.name,
      description: f.description,
      releaseDate: new Date(f.releaseDate!),
    }))
    .sort((a, b) => b.releaseDate.getTime() - a.releaseDate.getTime());

  // Filter insights from last 7 days
  const recentInsights = insights
    .filter((insight) => {
      const createdDate = new Date(insight.createdAt);
      return createdDate >= sevenDaysAgo && createdDate <= new Date();
    })
    .map((insight) => ({
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

  // Filter Q&A pairs from last 7 days
  const recentQAPairs = qaPairs
    .filter((qa) => {
      if (!qa.createdAt) return false;
      const createdDate = new Date(qa.createdAt);
      return createdDate >= sevenDaysAgo && createdDate <= new Date();
    })
    .map((qa) => ({
      ...qa,
      companyId: qa.companyId || '',
    }));

  const categoryObjects = categories.map((cat) => ({
    id: cat.id,
    name: cat.name,
  }));

  return (
    <div className="container mx-auto py-6 sm:py-8 px-4 sm:px-6">
      <div className="mb-6">
        <h2 className="text-xl sm:text-2xl font-semibold">Latest Activity</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Recent updates from the last 7 days
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Recent Meetings Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Recent Meetings (Last 7 Days)
            </CardTitle>
            <CardDescription>Latest meeting transcripts</CardDescription>
          </CardHeader>
          <CardContent>
            {recentTranscripts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No meetings in the last 7 days
              </p>
            ) : (
              <div className="space-y-3">
                {recentTranscripts.map((transcript) => (
                  <Link key={transcript.id} href={`/transcripts/${transcript.id}`}>
                    <div className="flex items-start justify-between gap-3 p-3 rounded-md hover-elevate cursor-pointer border" data-testid={`recent-transcript-${transcript.id}`}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {transcript.name || 'Untitled Meeting'}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {transcript.companyName}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0">
                        <Calendar className="h-3 w-3" />
                        {(() => {
                          const dateStr = typeof transcript.createdAt === 'string' ? transcript.createdAt : transcript.createdAt.toISOString();
                          const datePart = dateStr.split('T')[0];
                          return format(new Date(datePart + 'T12:00:00'), 'MMM d');
                        })()}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Releases Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Rocket className="h-4 w-4" />
              Recent Releases (Last 7 Days)
            </CardTitle>
            <CardDescription>Recently released features</CardDescription>
          </CardHeader>
          <CardContent>
            {recentFeatures.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No releases in the last 7 days
              </p>
            ) : (
              <div className="space-y-3">
                {recentFeatures.map((feature) => (
                  <Link key={feature.id} href={`/features/${feature.id}`}>
                    <div 
                      className="flex items-start justify-between gap-3 p-3 rounded-md hover-elevate cursor-pointer border" 
                      data-testid={`recent-feature-${feature.id}`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {feature.name}
                        </p>
                        {feature.description && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                            {feature.description}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0">
                        <Calendar className="h-3 w-3" />
                        {(() => {
                          const dateStr = typeof feature.releaseDate === 'string' ? feature.releaseDate : feature.releaseDate.toISOString();
                          const datePart = dateStr.split('T')[0];
                          return format(new Date(datePart + 'T12:00:00'), 'MMM d');
                        })()}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Product Insights */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-3">Recent Product Insights (Last 7 Days)</h3>
        {recentInsights.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">No insights in the last 7 days</p>
            </CardContent>
          </Card>
        ) : (
          <ProductInsightsTable insights={recentInsights} categories={categoryObjects} />
        )}
      </div>

      {/* Recent Q&A Pairs */}
      <div>
        <h3 className="text-lg font-semibold mb-3">Recent Q&A Pairs (Last 7 Days)</h3>
        {recentQAPairs.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">No Q&A pairs in the last 7 days</p>
            </CardContent>
          </Card>
        ) : (
          <QATable qaPairs={recentQAPairs} categories={categoryObjects} />
        )}
      </div>
    </div>
  );
}
