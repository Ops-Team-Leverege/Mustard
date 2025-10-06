import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Search, FileText, Trash2, Edit, Calendar, Building2 } from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";

interface Transcript {
  id: string;
  name: string | null;
  companyName: string;
  createdAt: Date;
}

export default function Transcripts() {
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: transcripts = [], isLoading } = useQuery<Transcript[]>({
    queryKey: ['/api/transcripts'],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/transcripts/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error('Failed to delete transcript');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/transcripts'] });
      toast({
        title: "Transcript deleted",
        description: "The transcript has been successfully deleted.",
      });
      setDeleteId(null);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete transcript",
        variant: "destructive",
      });
    },
  });

  const filteredTranscripts = transcripts.filter(transcript => {
    const searchLower = searchQuery.toLowerCase();
    const name = transcript.name?.toLowerCase() || '';
    const companyName = transcript.companyName.toLowerCase();
    return name.includes(searchLower) || companyName.includes(searchLower);
  });

  if (isLoading) {
    return (
      <div className="container mx-auto py-6 sm:py-8 px-4 sm:px-6">
        <div className="text-center py-12">
          <p className="text-muted-foreground">Loading transcripts...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 sm:py-8 px-4 sm:px-6">
      <div className="mb-4 sm:mb-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <h2 className="text-xl sm:text-2xl font-semibold">All Transcripts</h2>
            <p className="text-sm text-muted-foreground mt-1">
              View, edit, and manage all meeting transcripts
            </p>
          </div>
          <Badge variant="secondary" className="font-normal">
            {transcripts.length} {transcripts.length === 1 ? 'transcript' : 'transcripts'}
          </Badge>
        </div>
        
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or company..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-transcripts"
          />
        </div>
      </div>

      {filteredTranscripts.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <FileText className="mx-auto h-12 w-12 text-muted-foreground/50 mb-3" />
              <p className="text-muted-foreground">
                {searchQuery ? 'No transcripts match your search' : 'No transcripts found'}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredTranscripts.map((transcript) => (
            <Card key={transcript.id} className="hover-elevate">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <Link href={`/transcripts/${transcript.id}`}>
                      <CardTitle className="text-base hover:text-primary cursor-pointer transition-colors" data-testid={`link-transcript-${transcript.id}`}>
                        {transcript.name || 'Untitled Meeting'}
                      </CardTitle>
                    </Link>
                    <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground flex-wrap">
                      <div className="flex items-center gap-1">
                        <Building2 className="h-3.5 w-3.5" />
                        <span>{transcript.companyName}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        <span>{(() => {
                          const dateStr = typeof transcript.createdAt === 'string' ? transcript.createdAt : transcript.createdAt.toISOString();
                          const datePart = dateStr.split('T')[0];
                          return format(new Date(datePart + 'T12:00:00'), 'MMM d, yyyy');
                        })()}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link href={`/transcripts/${transcript.id}`}>
                      <Button 
                        variant="ghost" 
                        size="icon"
                        data-testid={`button-edit-transcript-${transcript.id}`}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                    </Link>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      onClick={() => setDeleteId(transcript.id)}
                      data-testid={`button-delete-transcript-${transcript.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Transcript?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this transcript and all associated insights and Q&A pairs. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
