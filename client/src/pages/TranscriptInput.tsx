import { useState } from "react";
import TranscriptForm, { TranscriptData } from "@/components/TranscriptForm";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";

export default function TranscriptInput() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const handleSubmit = async (data: TranscriptData) => {
    setIsAnalyzing(true);
    
    try {
      const response = await apiRequest('POST', '/api/transcripts', data);
      const result = await response.json();
      
      // Invalidate all relevant caches to ensure fresh data
      await queryClient.invalidateQueries({ queryKey: ['/api/companies'] });
      await queryClient.invalidateQueries({ queryKey: ['/api/transcripts'] });
      await queryClient.invalidateQueries({ queryKey: ['/api/insights'] });
      await queryClient.invalidateQueries({ queryKey: ['/api/qa'] });
      await queryClient.invalidateQueries({ queryKey: ['/api/companies', result.company.slug, 'overview'] });
      
      toast({
        title: "Analysis Complete",
        description: `Product insights and Q&A pairs have been extracted. Taking you to ${data.companyName}'s page...`,
      });
      
      // Navigate to company page using the slug from the server response
      setTimeout(() => {
        setLocation(`/companies/${result.company.slug}`);
      }, 1000);
    } catch (error) {
      toast({
        title: "Analysis Failed",
        description: error instanceof Error ? error.message : "Failed to analyze transcript",
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="container mx-auto py-8 px-6">
      <TranscriptForm onSubmit={handleSubmit} isAnalyzing={isAnalyzing} />
    </div>
  );
}
