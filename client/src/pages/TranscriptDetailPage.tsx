import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Calendar, Building2, Pencil, Check, X } from "lucide-react";
import { format } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    name: '',
    createdAt: '',
  });

  const { data, isLoading } = useQuery<TranscriptDetails>({
    queryKey: [`/api/transcripts/${transcriptId}/details`],
    enabled: !!transcriptId,
  });

  const { data: categories = [] } = useQuery<Array<{ id: string; name: string; description?: string }>>({
    queryKey: ['/api/categories'],
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { name: string; createdAt: string }) => {
      if (!transcriptId) throw new Error("Transcript not found");
      
      let createdAtISO = data.createdAt;
      if (data.createdAt) {
        const date = new Date(data.createdAt);
        date.setUTCHours(0, 0, 0, 0);
        createdAtISO = date.toISOString();
      }
      
      const res = await apiRequest('PATCH', `/api/transcripts/${transcriptId}`, {
        name: data.name || null,
        createdAt: createdAtISO,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.startsWith('/api/transcripts');
        }
      });
      setIsEditing(false);
      toast({
        title: "Success",
        description: "Transcript details updated successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update transcript details",
        variant: "destructive",
      });
    },
  });

  const handleStartEdit = () => {
    if (!data?.transcript) return;
    
    let createdAtString = '';
    if (data.transcript.createdAt) {
      const date = new Date(data.transcript.createdAt);
      createdAtString = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    }
    
    setEditForm({
      name: data.transcript.name || '',
      createdAt: createdAtString,
    });
    setIsEditing(true);
  };

  const handleSave = () => {
    updateMutation.mutate(editForm);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditForm({
      name: '',
      createdAt: '',
    });
  };

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
            <div className="space-y-2 flex-1 mr-4">
              {!isEditing ? (
                <>
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
                </>
              ) : (
                <div className="space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold mb-1">Transcript Name</h3>
                    <Input
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      placeholder="Transcript name"
                      data-testid="input-transcript-name"
                      className="text-xl font-bold"
                    />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold mb-1">Meeting Date</h3>
                    <Input
                      type="date"
                      value={editForm.createdAt}
                      onChange={(e) => setEditForm({ ...editForm, createdAt: e.target.value })}
                      data-testid="input-transcript-date"
                    />
                  </div>
                  {company && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Building2 className="h-4 w-4" />
                      <span>{company.name}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex gap-2 items-start flex-shrink-0">
              {!isEditing ? (
                <>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleStartEdit}
                    data-testid="button-edit-transcript"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Badge variant="outline" data-testid="badge-insights-count">
                    {insights.length} {insights.length === 1 ? 'Insight' : 'Insights'}
                  </Badge>
                  <Badge variant="outline" data-testid="badge-qa-count">
                    {qaPairs.length} Q&A
                  </Badge>
                </>
              ) : (
                <>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleSave}
                    disabled={updateMutation.isPending}
                    data-testid="button-save-transcript"
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleCancel}
                    disabled={updateMutation.isPending}
                    data-testid="button-cancel-edit"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {transcript.mainMeetingTakeaways && (
              <div>
                <h3 className="text-sm font-medium mb-2">Main Meeting Takeaways</h3>
                <div className="bg-muted/50 rounded-md p-4">
                  <p className="text-sm whitespace-pre-wrap" data-testid="main-meeting-takeaways">
                    {transcript.mainMeetingTakeaways}
                  </p>
                </div>
              </div>
            )}
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
