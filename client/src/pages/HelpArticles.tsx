import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, Loader2, ExternalLink } from "lucide-react";

interface SearchResult {
  id: string;
  title: string;
  snippet: string;
  link?: string;
}

interface SearchResponse {
  results: SearchResult[];
  totalSize: number;
  answer?: string;
}

export default function HelpArticles() {
  const [searchQuery, setSearchQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");

  const { data, isLoading, error } = useQuery<SearchResponse>({
    queryKey: [`/api/help/answer?q=${encodeURIComponent(submittedQuery)}`],
    enabled: !!submittedQuery,
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setSubmittedQuery(searchQuery.trim());
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <h1 className="text-2xl font-bold mb-6">Help Articles</h1>
      
      <form onSubmit={handleSearch} className="flex gap-2 mb-6">
        <Input
          placeholder="Search help articles..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1"
          data-testid="input-help-search"
        />
        <Button type="submit" disabled={isLoading} data-testid="button-search">
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Search
        </Button>
      </form>

      {error && (
        <Card className="mb-4 border-destructive">
          <CardContent className="pt-4">
            <p className="text-destructive">Error searching: {error instanceof Error ? error.message : "Unknown error"}</p>
          </CardContent>
        </Card>
      )}

      {data?.answer && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Answer</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground whitespace-pre-wrap">{data.answer}</p>
          </CardContent>
        </Card>
      )}

      {data?.results && data.results.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Related Articles ({data.totalSize})</h2>
          {data.results.map((result) => (
            <Card key={result.id} className="hover-elevate" data-testid={`card-result-${result.id}`}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  {result.title}
                  {result.link && (
                    <a 
                      href={result.link} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p 
                  className="text-sm text-muted-foreground"
                  dangerouslySetInnerHTML={{ __html: result.snippet }}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {submittedQuery && !isLoading && data?.results?.length === 0 && (
        <p className="text-muted-foreground text-center py-8">No results found for "{submittedQuery}"</p>
      )}
    </div>
  );
}
