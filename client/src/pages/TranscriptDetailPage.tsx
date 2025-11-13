import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowLeft, Calendar, Building2, Pencil, Check, X, Loader2, AlertCircle } from "lucide-react";
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
    mainMeetingTakeaways: '',
    nextSteps: '',
    supportingMaterials: '',
    transcript: '',
  });

  const { data, isLoading } = useQuery<TranscriptDetails>({
    queryKey: [`/api/transcripts/${transcriptId}/details`],
    enabled: !!transcriptId,
    // Poll every 2 seconds while processing
    refetchInterval: (query) => {
      const transcript = query.state.data?.transcript;
      const status = transcript?.processingStatus;
      return (status === "pending" || status === "processing") ? 2000 : false;
    },
  });

  const { data: categories = [] } = useQuery<Array<{ id: string; name: string; description?: string }>>({
    queryKey: ['/api/categories'],
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { name: string; createdAt: string; mainMeetingTakeaways: string; nextSteps: string; supportingMaterials: string; transcript: string }) => {
      if (!transcriptId) throw new Error("Transcript not found");
      
      let createdAtISO = data.createdAt;
      if (data.createdAt) {
        createdAtISO = new Date(data.createdAt + 'T12:00:00').toISOString();
      }
      
      const res = await apiRequest('PATCH', `/api/transcripts/${transcriptId}`, {
        name: data.name || null,
        createdAt: createdAtISO,
        mainMeetingTakeaways: data.mainMeetingTakeaways || null,
        nextSteps: data.nextSteps || null,
        supportingMaterials: data.supportingMaterials || null,
        transcript: data.transcript || null,
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

  const retryMutation = useMutation({
    mutationFn: async () => {
      if (!transcriptId) throw new Error("Transcript not found");
      const res = await apiRequest('POST', `/api/transcripts/${transcriptId}/retry`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.startsWith('/api/transcripts');
        }
      });
      toast({
        title: "Success",
        description: "Transcript analysis restarted",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to restart analysis",
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
      mainMeetingTakeaways: data.transcript.mainMeetingTakeaways || '',
      nextSteps: data.transcript.nextSteps || '',
      supportingMaterials: data.transcript.supportingMaterials || '',
      transcript: data.transcript.transcript || '',
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
      mainMeetingTakeaways: '',
      nextSteps: '',
      supportingMaterials: '',
      transcript: '',
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
  const processingStatus = transcript.processingStatus;
  const processingStep = transcript.processingStep;
  const isProcessing = processingStatus === "pending" || processingStatus === "processing";
  const isFailed = processingStatus === "failed";

  // Calculate processing duration and detect stuck transcripts
  const getProcessingDuration = (): { minutes: number; isStuck: boolean; durationText: string } | null => {
    if (!transcript.processingStartedAt) return null;
    
    const startTime = new Date(transcript.processingStartedAt).getTime();
    const now = Date.now();
    const durationMs = now - startTime;
    const minutes = Math.floor(durationMs / (1000 * 60));
    const isStuck = minutes > 10;
    
    let durationText = "";
    if (minutes < 1) {
      durationText = "Less than a minute";
    } else if (minutes === 1) {
      durationText = "1 minute";
    } else {
      durationText = `${minutes} minutes`;
    }
    
    return { minutes, isStuck, durationText };
  };

  const processingDuration = getProcessingDuration();
  const isStuckProcessing = isProcessing && processingDuration?.isStuck;

  // Map processing steps to user-friendly labels
  const getStepLabel = (step: string | null): string => {
    if (!step) return "Waiting to start...";
    const stepMap: Record<string, string> = {
      analyzing_transcript: "Analyzing transcript with AI",
      extracting_insights: "Extracting product insights",
      extracting_qa: "Extracting Q&A pairs",
      detecting_pos_systems: "Detecting POS systems",
      complete: "Analysis complete"
    };
    return stepMap[step] || step;
  };

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

      {/* Stuck processing alert - shows when processing for >10 minutes */}
      {isStuckProcessing && (
        <Alert variant="destructive" data-testid="alert-stuck-processing">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Processing May Be Stuck</AlertTitle>
          <AlertDescription>
            <div className="space-y-2">
              <div>
                This transcript has been processing for {processingDuration?.durationText}. 
                The server may have restarted during analysis.
              </div>
              <div className="text-xs">Current step: {getStepLabel(processingStep)}</div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => retryMutation.mutate()}
                disabled={retryMutation.isPending}
                data-testid="button-retry-stuck-analysis"
                className="bg-background hover-elevate active-elevate-2"
              >
                {retryMutation.isPending ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                    Retrying...
                  </>
                ) : (
                  "Retry Analysis"
                )}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Normal processing banner - shows when processing <10 minutes */}
      {isProcessing && !isStuckProcessing && (
        <Alert data-testid="alert-processing">
          <Loader2 className="h-4 w-4 animate-spin" />
          <AlertTitle>Processing Transcript</AlertTitle>
          <AlertDescription>
            <div className="space-y-1">
              <div>{getStepLabel(processingStep)}</div>
              {processingDuration && (
                <div className="text-xs text-muted-foreground">
                  Processing for {processingDuration.durationText}...
                </div>
              )}
              <div className="text-xs text-muted-foreground">This page will automatically update when complete.</div>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Error status banner - shows when processing failed */}
      {isFailed && (
        <Alert variant="destructive" data-testid="alert-failed">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Processing Failed</AlertTitle>
          <AlertDescription>
            <div className="space-y-2">
              <div>{transcript.processingError || "An error occurred while processing this transcript."}</div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => retryMutation.mutate()}
                disabled={retryMutation.isPending}
                data-testid="button-retry-analysis"
                className="bg-background hover-elevate active-elevate-2"
              >
                {retryMutation.isPending ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                    Retrying...
                  </>
                ) : (
                  "Retry Analysis"
                )}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

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
                      <span>{(() => {
                        const dateStr = typeof transcript.createdAt === 'string' ? transcript.createdAt : transcript.createdAt.toISOString();
                        const datePart = dateStr.split('T')[0];
                        return format(new Date(datePart + 'T12:00:00'), "MMMM d, yyyy");
                      })()}</span>
                    </div>
                  </div>
                  {transcript.mainMeetingTakeaways && (
                    <div className="mt-3">
                      <h3 className="text-sm font-medium mb-1">Main Meeting Takeaways</h3>
                      <div className="bg-muted/50 rounded-md p-4 max-h-60 overflow-y-auto">
                        <p className="text-sm whitespace-pre-wrap" data-testid="main-meeting-takeaways">
                          {transcript.mainMeetingTakeaways}
                        </p>
                      </div>
                    </div>
                  )}
                  {transcript.nextSteps && transcript.nextSteps.trim() && (
                    <div className="mt-3">
                      <h3 className="text-sm font-medium mb-1">Next Steps</h3>
                      <div className="bg-muted/50 rounded-md p-4 max-h-60 overflow-y-auto">
                        <p className="text-sm whitespace-pre-wrap" data-testid="next-steps">
                          {transcript.nextSteps}
                        </p>
                      </div>
                    </div>
                  )}
                  {transcript.supportingMaterials && transcript.supportingMaterials.trim() && (
                    <div className="mt-3">
                      <h3 className="text-sm font-medium mb-1">Supporting Materials</h3>
                      <div className="bg-muted/50 rounded-md p-4">
                        {(() => {
                          const material = transcript.supportingMaterials;
                          try {
                            const url = new URL(material);
                            // Only allow http and https schemes to prevent XSS
                            if (url.protocol === 'http:' || url.protocol === 'https:') {
                              return (
                                <a 
                                  href={material} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="text-sm text-primary hover:underline"
                                  data-testid="supporting-materials-link"
                                >
                                  {material}
                                </a>
                              );
                            }
                            // Invalid scheme - render as text
                            return (
                              <p className="text-sm" data-testid="supporting-materials-file">
                                {material}
                              </p>
                            );
                          } catch {
                            // Not a valid URL - render as text (likely a filename)
                            return (
                              <p className="text-sm" data-testid="supporting-materials-file">
                                {material}
                              </p>
                            );
                          }
                        })()}
                      </div>
                    </div>
                  )}
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
                  <div>
                    <h3 className="text-sm font-semibold mb-1">Main Meeting Takeaways</h3>
                    <Textarea
                      value={editForm.mainMeetingTakeaways}
                      onChange={(e) => setEditForm({ ...editForm, mainMeetingTakeaways: e.target.value })}
                      placeholder="Summarize the key takeaways from this meeting..."
                      className="min-h-[100px]"
                      data-testid="input-main-meeting-takeaways"
                    />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold mb-1">Next Steps</h3>
                    <Textarea
                      value={editForm.nextSteps}
                      onChange={(e) => setEditForm({ ...editForm, nextSteps: e.target.value })}
                      placeholder="What are the next steps for this opportunity?"
                      className="min-h-[100px]"
                      data-testid="input-next-steps"
                    />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold mb-1">Supporting Materials</h3>
                    <Input
                      value={editForm.supportingMaterials}
                      onChange={(e) => setEditForm({ ...editForm, supportingMaterials: e.target.value })}
                      placeholder="File name or URL of supporting materials"
                      data-testid="input-supporting-materials"
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
            <div>
              <h3 className="text-sm font-medium mb-2">Transcript Content</h3>
              {!isEditing ? (
                <div className="bg-muted/50 rounded-md p-4 max-h-60 overflow-y-auto">
                  <p className="text-sm whitespace-pre-wrap" data-testid="transcript-content">
                    {transcript.transcript}
                  </p>
                </div>
              ) : (
                <Textarea
                  value={editForm.transcript}
                  onChange={(e) => setEditForm({ ...editForm, transcript: e.target.value })}
                  placeholder="Paste the full transcript here..."
                  className="min-h-[240px]"
                  data-testid="input-transcript-content"
                />
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Show insights/Q&A only when processing is complete */}
      {!isProcessing && (
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
      )}

      {/* Show placeholder while processing */}
      {isProcessing && (
        <Card>
          <CardContent className="p-12 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground" data-testid="text-processing-message">
              Analyzing transcript and extracting insights...
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
