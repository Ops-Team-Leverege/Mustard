import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import ProductInsightsTable from "@/components/ProductInsightsTable";
import QATable from "@/components/QATable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Pencil, Check, X } from "lucide-react";
import { useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { CompanyOverview } from "@shared/schema";

export default function CompanyPage() {
  const params = useParams();
  const companySlug = params.slug;
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    companyDescription: '',
    mainInterestAreas: '',
    numberOfStores: '',
  });

  const { data: overview, isLoading } = useQuery<CompanyOverview>({
    queryKey: [`/api/companies/${companySlug}/overview`],
    enabled: !!companySlug,
  });

  const { data: categories = [] } = useQuery<Array<{ id: string; name: string; description?: string }>>({
    queryKey: ['/api/categories'],
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { companyDescription: string; mainInterestAreas: string; numberOfStores: string }) => {
      if (!overview?.company.id) throw new Error("Company not found");
      const res = await apiRequest('PATCH', `/api/companies/${overview.company.id}`, {
        name: overview.company.name,
        notes: overview.company.notes,
        companyDescription: data.companyDescription,
        mainInterestAreas: data.mainInterestAreas,
        numberOfStores: data.numberOfStores,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.startsWith('/api/companies');
        }
      });
      setIsEditing(false);
      toast({
        title: "Success",
        description: "Company details updated successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update company details",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Company Not Found</CardTitle>
            <CardDescription>The requested company does not exist.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const handleStartEdit = () => {
    setEditForm({
      companyDescription: overview?.company.companyDescription || '',
      mainInterestAreas: overview?.company.mainInterestAreas || '',
      numberOfStores: overview?.company.numberOfStores || '',
    });
    setIsEditing(true);
  };

  const handleSave = () => {
    updateMutation.mutate(editForm);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditForm({
      companyDescription: '',
      mainInterestAreas: '',
      numberOfStores: '',
    });
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <Card>
        <CardHeader>
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <CardTitle className="text-2xl sm:text-3xl">{overview.company.name}</CardTitle>
                {overview.company.notes && (
                  <CardDescription className="mt-2">{overview.company.notes}</CardDescription>
                )}
              </div>
              {!isEditing ? (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={handleStartEdit}
                  data-testid="button-edit-company"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleSave}
                    disabled={updateMutation.isPending}
                    data-testid="button-save-company"
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleCancel}
                    disabled={updateMutation.isPending}
                    data-testid="button-cancel-edit"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>

            <div className="flex gap-2 items-center flex-wrap">
              <Badge variant="secondary" data-testid="badge-transcript-count">
                {overview.transcriptCount} {overview.transcriptCount === 1 ? 'Transcript' : 'Transcripts'}
              </Badge>
              <Badge variant="secondary" data-testid="badge-insight-count">
                {overview.insightCount} {overview.insightCount === 1 ? 'Insight' : 'Insights'}
              </Badge>
              <Badge variant="secondary" data-testid="badge-qa-count">
                {overview.qaCount} Q&A {overview.qaCount === 1 ? 'Pair' : 'Pairs'}
              </Badge>
            </div>

            <div className="space-y-4">
              {!isEditing ? (
                <>
                  {overview.company.companyDescription && (
                    <div>
                      <h3 className="text-sm font-semibold mb-1">Company Description</h3>
                      <p className="text-sm text-muted-foreground" data-testid="text-company-description">
                        {overview.company.companyDescription}
                      </p>
                    </div>
                  )}
                  {overview.company.mainInterestAreas && (
                    <div>
                      <h3 className="text-sm font-semibold mb-1">Main Interest Areas</h3>
                      <p className="text-sm text-muted-foreground" data-testid="text-main-interest-areas">
                        {overview.company.mainInterestAreas}
                      </p>
                    </div>
                  )}
                  {overview.company.numberOfStores && (
                    <div>
                      <h3 className="text-sm font-semibold mb-1">Number of Stores</h3>
                      <p className="text-sm text-muted-foreground" data-testid="text-number-of-stores">
                        {overview.company.numberOfStores}
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold mb-1">Company Description</h3>
                    <Textarea
                      value={editForm.companyDescription}
                      onChange={(e) => setEditForm({ ...editForm, companyDescription: e.target.value })}
                      placeholder="Describe the company..."
                      className="min-h-[80px]"
                      data-testid="input-company-description"
                    />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold mb-1">Main Interest Areas</h3>
                    <Textarea
                      value={editForm.mainInterestAreas}
                      onChange={(e) => setEditForm({ ...editForm, mainInterestAreas: e.target.value })}
                      placeholder="Main product features or areas of interest..."
                      className="min-h-[80px]"
                      data-testid="input-main-interest-areas"
                    />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold mb-1">Number of Stores</h3>
                    <Input
                      value={editForm.numberOfStores}
                      onChange={(e) => setEditForm({ ...editForm, numberOfStores: e.target.value })}
                      placeholder="e.g., 50 stores"
                      data-testid="input-number-of-stores"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Product Insights</CardTitle>
          <CardDescription>
            Feature requests and product feedback from {overview.company.name}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProductInsightsTable 
            insights={overview.insights.map(i => ({
              ...i,
              category: i.categoryName || 'NEW',
            }))}
            categories={categories}
            defaultCompany={overview.company.name}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Q&A Pairs</CardTitle>
          <CardDescription>
            Questions and answers from {overview.company.name} calls
          </CardDescription>
        </CardHeader>
        <CardContent>
          <QATable 
            qaPairs={overview.qaPairs.map(qa => ({
              ...qa,
              category: qa.categoryName || 'NEW',
            }))}
            categories={categories}
            defaultCompany={overview.company.name}
          />
        </CardContent>
      </Card>
    </div>
  );
}
