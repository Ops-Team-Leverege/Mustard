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
  companyDescription?: string;
  numberOfStores?: string;
  contactJobTitle?: string;
  mainInterestAreas?: string;
}

export default function TranscriptForm({ onSubmit, isAnalyzing = false }: TranscriptFormProps) {
  const [formData, setFormData] = useState<TranscriptData>({
    companyName: '',
    transcript: '',
    leverageTeam: '',
    customerNames: '',
    companyDescription: '',
    numberOfStores: '',
    contactJobTitle: '',
    mainInterestAreas: '',
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

          <div className="space-y-2">
            <Label htmlFor="companyDescription" data-testid="label-company-description">Company Description</Label>
            <Textarea
              id="companyDescription"
              data-testid="input-company-description"
              placeholder="Describe the company, their business model, and key details..."
              className="min-h-[100px]"
              value={formData.companyDescription}
              onChange={(e) => setFormData({ ...formData, companyDescription: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="numberOfStores" data-testid="label-number-of-stores">Number of Stores</Label>
            <Input
              id="numberOfStores"
              data-testid="input-number-of-stores"
              placeholder="e.g., 150 or Not applicable"
              value={formData.numberOfStores}
              onChange={(e) => setFormData({ ...formData, numberOfStores: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="contactJobTitle" data-testid="label-contact-job-title">Contact Job Title</Label>
            <Input
              id="contactJobTitle"
              data-testid="input-contact-job-title"
              placeholder="e.g., VP of Operations, CTO"
              value={formData.contactJobTitle}
              onChange={(e) => setFormData({ ...formData, contactJobTitle: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="mainInterestAreas" data-testid="label-main-interest-areas">Main Interest Areas in Product</Label>
            <Textarea
              id="mainInterestAreas"
              data-testid="input-main-interest-areas"
              placeholder="Describe the main product features or areas they're interested in..."
              className="min-h-[100px]"
              value={formData.mainInterestAreas}
              onChange={(e) => setFormData({ ...formData, mainInterestAreas: e.target.value })}
            />
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
