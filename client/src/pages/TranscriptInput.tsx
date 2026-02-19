import { useState } from "react";
import TranscriptForm, { TranscriptData } from "@/components/TranscriptForm";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useQuery } from "@tanstack/react-query";
import type { Product } from "@shared/schema";

interface User {
  id: string;
  email: string | null;
  currentProduct: Product;
}

export default function TranscriptInput() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const { data: user } = useQuery<User>({
    queryKey: ["/api/auth/user"],
  });

  const handleSubmit = async (data: TranscriptData) => {
    if (isSubmitting) return; // Prevent double submission

    setIsSubmitting(true);
    try {
      const submissionData = {
        ...data,
        createdAt: data.meetingDate && data.meetingDate.trim() ? new Date(data.meetingDate + 'T12:00:00').toISOString() : undefined,
      };
      const response = await apiRequest('POST', '/api/transcripts', submissionData);
      const result = await response.json();

      // Invalidate all relevant caches to ensure fresh data
      await queryClient.invalidateQueries({ queryKey: ['/api/companies'] });
      await queryClient.invalidateQueries({ queryKey: ['/api/transcripts'] });

      toast({
        title: "Transcript Created",
        description: "AI analysis is running in the background. You'll see results as they become available.",
      });

      // Navigate to transcript detail page immediately
      setLocation(`/transcripts/${result.transcript.id}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to create transcript";

      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
      setIsSubmitting(false); // Re-enable form only on error
    }
  };

  const currentProduct = user?.currentProduct || "PitCrew";

  // Hide the entire page for "All Activity" view
  if (currentProduct === "All Activity") {
    return (
      <div className="container mx-auto py-6 sm:py-8 px-4 sm:px-6">
        <Alert className="border-2 border-muted">
          <AlertCircle className="h-5 w-5" />
          <AlertDescription className="ml-2">
            <span className="font-semibold text-lg">Cannot add transcripts in All Activity view</span>
            <p className="text-sm mt-1 text-muted-foreground">
              Please switch to a specific product to add a new transcript.
            </p>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 sm:py-8 px-4 sm:px-6">
      <Alert className="mb-6 border-2 border-primary bg-primary/10">
        <AlertCircle className="h-5 w-5 text-primary" />
        <AlertDescription className="ml-2">
          <span className="font-semibold text-lg">Adding transcript for: {currentProduct}</span>
          <p className="text-sm mt-1 text-muted-foreground">
            This transcript will be saved to <strong>{currentProduct}</strong>.
          </p>
        </AlertDescription>
      </Alert>
      <TranscriptForm onSubmit={handleSubmit} isSubmitting={isSubmitting} />
    </div>
  );
}
