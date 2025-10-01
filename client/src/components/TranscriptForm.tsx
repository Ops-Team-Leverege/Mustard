import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Sparkles, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface TranscriptFormProps {
  onSubmit?: (data: TranscriptData) => void;
  isAnalyzing?: boolean;
}

export interface TranscriptData {
  companyName: string;
  transcript: string;
  leverageTeam: string;
  customerNames: string;
}

export default function TranscriptForm({ onSubmit, isAnalyzing = false }: TranscriptFormProps) {
  const [formData, setFormData] = useState<TranscriptData>({
    companyName: '',
    transcript: '',
    leverageTeam: '',
    customerNames: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Transcript submitted:', formData);
    onSubmit?.(formData);
  };

  return (
    <Card className="max-w-4xl mx-auto">
      <CardHeader>
        <CardTitle className="text-2xl font-semibold">Add New Transcript</CardTitle>
        <CardDescription>
          Upload BD call transcript to extract product insights and customer questions
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="companyName" data-testid="label-company-name">Company Name</Label>
            <Input
              id="companyName"
              data-testid="input-company-name"
              placeholder="e.g., Acme Corporation"
              value={formData.companyName}
              onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="transcript" data-testid="label-transcript">Transcript</Label>
            <Textarea
              id="transcript"
              data-testid="input-transcript"
              placeholder="Paste the full BD call transcript here..."
              className="min-h-[200px] font-mono text-sm"
              value={formData.transcript}
              onChange={(e) => setFormData({ ...formData, transcript: e.target.value })}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="leverageTeam" data-testid="label-leverage-team">Leverege Team Members</Label>
            <Input
              id="leverageTeam"
              data-testid="input-leverage-team"
              placeholder="e.g., John Smith, Sarah Johnson"
              value={formData.leverageTeam}
              onChange={(e) => setFormData({ ...formData, leverageTeam: e.target.value })}
              required
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated list of Leverege team members on the call
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="customerNames" data-testid="label-customer-names">Customer Names</Label>
            <Input
              id="customerNames"
              data-testid="input-customer-names"
              placeholder="e.g., Mike Chen, Lisa Anderson"
              value={formData.customerNames}
              onChange={(e) => setFormData({ ...formData, customerNames: e.target.value })}
              required
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated list of customer attendees
            </p>
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={isAnalyzing}
            data-testid="button-analyze-transcript"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Analyze Transcript
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
