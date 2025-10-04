import { useState, useEffect } from "react";
import TranscriptForm, { TranscriptData } from "@/components/TranscriptForm";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, Sparkles, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function TranscriptInput() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStep, setAnalysisStep] = useState(0);
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isAnalyzing) return;
    
    // Simulate analysis progress steps for better UX
    const steps = [
      { delay: 0, step: 0 },
      { delay: 3000, step: 1 },
      { delay: 8000, step: 2 },
      { delay: 15000, step: 3 },
    ];
    
    const timers = steps.map(({ delay, step }) =>
      setTimeout(() => setAnalysisStep(step), delay)
    );
    
    return () => timers.forEach(clearTimeout);
  }, [isAnalyzing]);

  const handleSubmit = async (data: TranscriptData) => {
    setIsAnalyzing(true);
    
    try {
      const submissionData = {
        ...data,
        createdAt: data.meetingDate ? new Date(data.meetingDate).toISOString() : undefined,
      };
      const response = await apiRequest('POST', '/api/transcripts', submissionData);
      const result = await response.json();
      
      // Invalidate all relevant caches to ensure fresh data
      await queryClient.invalidateQueries({ queryKey: ['/api/companies'] });
      await queryClient.invalidateQueries({ queryKey: ['/api/transcripts'] });
      await queryClient.invalidateQueries({ queryKey: ['/api/insights'] });
      await queryClient.invalidateQueries({ queryKey: ['/api/qa'] });
      await queryClient.invalidateQueries({ queryKey: ['/api/companies', result.company.slug, 'overview'] });
      
      toast({
        title: "Analysis Complete",
        description: `Product insights and Q&A pairs have been extracted. Taking you to the transcript...`,
      });
      
      // Navigate to transcript detail page
      setTimeout(() => {
        setLocation(`/transcripts/${result.transcript.id}`);
      }, 1000);
    } catch (error) {
      console.error('[TranscriptInput] Error during submission:', error);
      toast({
        title: "Analysis Failed",
        description: error instanceof Error ? error.message : "Failed to analyze transcript",
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const analysisSteps = [
    { label: "Reading transcript", description: "Processing your conversation..." },
    { label: "Identifying product insights", description: "Finding valuable customer feedback..." },
    { label: "Extracting Q&A pairs", description: "Categorizing questions and answers..." },
    { label: "Organizing findings", description: "Almost done..." },
  ];

  return (
    <div className="container mx-auto py-6 sm:py-8 px-4 sm:px-6">
      {isAnalyzing ? (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="max-w-lg w-full">
            <CardContent className="pt-6">
              <div className="flex flex-col items-center text-center space-y-6">
                <div className="relative">
                  <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
                    <Sparkles className="w-10 h-10 text-primary animate-pulse" />
                  </div>
                  <Loader2 className="w-24 h-24 text-primary/30 animate-spin absolute -top-2 -left-2" />
                </div>
                
                <div className="space-y-2">
                  <h2 className="text-2xl font-semibold">Analyzing Transcript</h2>
                  <p className="text-sm text-muted-foreground">
                    This may take 1-3 minutes for long transcripts. Please don't navigate away.
                  </p>
                </div>

                <div className="w-full space-y-4">
                  {analysisSteps.map((step, index) => (
                    <div
                      key={index}
                      className="flex items-start gap-3 text-left"
                      data-testid={`analysis-step-${index}`}
                    >
                      <div className="mt-0.5">
                        {index < analysisStep ? (
                          <CheckCircle2 className="w-5 h-5 text-primary" />
                        ) : index === analysisStep ? (
                          <Loader2 className="w-5 h-5 text-primary animate-spin" />
                        ) : (
                          <div className="w-5 h-5 rounded-full border-2 border-muted" />
                        )}
                      </div>
                      <div className="flex-1 space-y-1">
                        <p className={`font-medium ${index <= analysisStep ? 'text-foreground' : 'text-muted-foreground'}`}>
                          {step.label}
                        </p>
                        {index === analysisStep && (
                          <p className="text-sm text-muted-foreground">
                            {step.description}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
      
      <div className={isAnalyzing ? "opacity-50 pointer-events-none" : ""}>
        <TranscriptForm onSubmit={handleSubmit} isAnalyzing={isAnalyzing} />
      </div>
    </div>
  );
}
