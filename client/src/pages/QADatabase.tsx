import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import QATable from "@/components/QATable";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function QADatabase() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isAddingQA, setIsAddingQA] = useState(false);
  const [newQAForm, setNewQAForm] = useState({
    question: '',
    answer: '',
    asker: '',
    company: '',
  });

  const { data: qaPairs = [], isLoading } = useQuery<any[]>({
    queryKey: ['/api/qa-pairs'],
  });

  const addQAMutation = useMutation({
    mutationFn: async (data: { question: string; answer: string; asker: string; company: string }) => {
      const res = await apiRequest('POST', '/api/qa-pairs', data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/qa-pairs'] });
      setIsAddingQA(false);
      setNewQAForm({ question: '', answer: '', asker: '', company: '' });
      toast({
        title: "Success",
        description: "Q&A pair added successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add Q&A pair",
        variant: "destructive",
      });
    },
  });

  const handleAddQA = () => {
    if (!newQAForm.question || !newQAForm.answer || !newQAForm.asker || !newQAForm.company) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }
    addQAMutation.mutate(newQAForm);
  };

  return (
    <div className="container mx-auto py-8 px-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold">Customer Q&A Database</h1>
          <p className="text-muted-foreground mt-1">
            Product-specific questions and BD answers
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setIsAddingQA(true)} data-testid="button-add-qa">
            <Plus className="w-4 h-4 mr-2" />
            Add Q&A
          </Button>
          <Button onClick={() => setLocation('/')} data-testid="button-add-transcript">
            <Plus className="w-4 h-4 mr-2" />
            Add Transcript
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading Q&A pairs...</div>
      ) : (
        <QATable qaPairs={qaPairs as any[]} />
      )}

      <Dialog open={isAddingQA} onOpenChange={setIsAddingQA}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Q&A Pair</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="question">Question *</Label>
              <Textarea
                id="question"
                value={newQAForm.question}
                onChange={(e) => setNewQAForm({ ...newQAForm, question: e.target.value })}
                placeholder="What question was asked?"
                data-testid="textarea-add-question"
              />
            </div>
            <div>
              <Label htmlFor="answer">Answer *</Label>
              <Textarea
                id="answer"
                value={newQAForm.answer}
                onChange={(e) => setNewQAForm({ ...newQAForm, answer: e.target.value })}
                placeholder="What answer was provided?"
                data-testid="textarea-add-answer"
              />
            </div>
            <div>
              <Label htmlFor="asker">Asked By *</Label>
              <Input
                id="asker"
                value={newQAForm.asker}
                onChange={(e) => setNewQAForm({ ...newQAForm, asker: e.target.value })}
                placeholder="Customer name"
                data-testid="input-add-asker"
              />
            </div>
            <div>
              <Label htmlFor="company">Company *</Label>
              <Input
                id="company"
                value={newQAForm.company}
                onChange={(e) => setNewQAForm({ ...newQAForm, company: e.target.value })}
                placeholder="Company name"
                data-testid="input-add-company-qa"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddingQA(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleAddQA} 
              disabled={addQAMutation.isPending}
              data-testid="button-save-add-qa"
            >
              {addQAMutation.isPending ? "Adding..." : "Add Q&A"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
