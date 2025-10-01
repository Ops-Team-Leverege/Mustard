import { useState } from "react";
import TranscriptForm, { TranscriptData } from "@/components/TranscriptForm";
import { useToast } from "@/hooks/use-toast";

export default function TranscriptInput() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (data: TranscriptData) => {
    setIsAnalyzing(true);
    console.log('Analyzing transcript:', data);
    
    // Simulate AI analysis
    setTimeout(() => {
      setIsAnalyzing(false);
      toast({
        title: "Analysis Complete",
        description: "Product insights and Q&A pairs have been extracted successfully.",
      });
    }, 2000);
  };

  return (
    <div className="container mx-auto py-8 px-6">
      <TranscriptForm onSubmit={handleSubmit} isAnalyzing={isAnalyzing} />
    </div>
  );
}
