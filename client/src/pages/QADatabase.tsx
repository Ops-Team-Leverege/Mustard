import { useQuery } from "@tanstack/react-query";
import QATable from "@/components/QATable";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useLocation } from "wouter";

export default function QADatabase() {
  const [, setLocation] = useLocation();

  const { data: qaPairs = [], isLoading } = useQuery<any[]>({
    queryKey: ['/api/qa-pairs'],
  });

  return (
    <div className="container mx-auto py-8 px-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold">Customer Q&A Database</h1>
          <p className="text-muted-foreground mt-1">
            Product-specific questions and BD answers
          </p>
        </div>
        <Button onClick={() => setLocation('/')} data-testid="button-add-transcript">
          <Plus className="w-4 h-4 mr-2" />
          Add Transcript
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading Q&A pairs...</div>
      ) : (
        <QATable qaPairs={qaPairs as any[]} />
      )}
    </div>
  );
}
