import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, ExternalLink, Pencil, Check, X } from "lucide-react";
import ProductInsightsTable, { ProductInsight } from "@/components/ProductInsightsTable";

type Feature = {
  id: string;
  name: string;
  description: string | null;
  value: string | null;
  videoLink: string | null;
  helpGuideLink: string | null;
  categoryId: string | null;
  categoryName: string | null;
  releaseDate: Date | null;
  createdAt: Date;
};

type Category = {
  id: string;
  name: string;
};

export default function FeatureDetail() {
  const params = useParams<{ id: string }>();
  const featureId = params.id;
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    name: '',
    description: '',
    value: '',
    videoLink: '',
    helpGuideLink: '',
    categoryId: '',
    releaseDate: null as Date | null,
  });

  const { data: feature, isLoading: isLoadingFeature } = useQuery<Feature>({
    queryKey: [`/api/features/${featureId}`],
    enabled: !!featureId,
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['/api/categories'],
  });

  const { data: allInsights = [], isLoading: isLoadingInsights } = useQuery<ProductInsight[]>({
    queryKey: ['/api/insights'],
    enabled: !!feature?.categoryId,
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { name: string; description: string | null; value: string | null; videoLink: string | null; helpGuideLink: string | null; categoryId: string | null; releaseDate: Date | null }) => {
      const res = await apiRequest('PATCH', `/api/features/${featureId}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/features/${featureId}`] });
      queryClient.invalidateQueries({ queryKey: ['/api/features'] });
      setIsEditing(false);
      toast({
        title: "Feature Updated",
        description: "The feature has been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Update Feature",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const insights = allInsights.filter(insight => insight.categoryId === feature?.categoryId);

  const handleStartEdit = () => {
    if (feature) {
      setEditForm({
        name: feature.name,
        description: feature.description || '',
        value: feature.value || '',
        videoLink: feature.videoLink || '',
        helpGuideLink: feature.helpGuideLink || '',
        categoryId: feature.categoryId || 'none',
        releaseDate: feature.releaseDate,
      });
      setIsEditing(true);
    }
  };

  const handleSave = () => {
    updateMutation.mutate({
      name: editForm.name,
      description: editForm.description || null,
      value: editForm.value || null,
      videoLink: editForm.videoLink || null,
      helpGuideLink: editForm.helpGuideLink || null,
      categoryId: editForm.categoryId === 'none' ? null : editForm.categoryId,
      releaseDate: editForm.releaseDate,
    });
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditForm({
      name: '',
      description: '',
      value: '',
      videoLink: '',
      helpGuideLink: '',
      categoryId: '',
      releaseDate: null,
    });
  };

  if (isLoadingFeature) {
    return (
      <div className="container mx-auto py-8 px-6">
        <div className="text-center py-12 text-muted-foreground">Loading feature...</div>
      </div>
    );
  }

  if (!feature) {
    return (
      <div className="container mx-auto py-8 px-6">
        <div className="text-center py-12 text-muted-foreground">Feature not found</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-6">
      <Link href="/features">
        <Button variant="ghost" className="mb-6" data-testid="button-back-to-features">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Features
        </Button>
      </Link>

      <Card className="mb-8">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              {!isEditing ? (
                <>
                  <CardTitle className="text-2xl mb-2" data-testid="text-feature-name">
                    {feature.name}
                  </CardTitle>
                  {feature.categoryName && (
                    <Badge variant="secondary" className="mb-3" data-testid="badge-category">
                      {feature.categoryName}
                    </Badge>
                  )}
                </>
              ) : (
                <div className="space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold mb-1">Feature Name</h3>
                    <Input
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      placeholder="Feature name"
                      data-testid="input-edit-name"
                      className="text-xl font-bold"
                    />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold mb-1">Category</h3>
                    <Select
                      value={editForm.categoryId}
                      onValueChange={(value) => setEditForm({ ...editForm, categoryId: value })}
                    >
                      <SelectTrigger data-testid="select-edit-category">
                        <SelectValue placeholder="Select a category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {categories.map((cat) => (
                          <SelectItem key={cat.id} value={cat.id}>
                            {cat.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </div>
            {!isEditing ? (
              <Button
                size="icon"
                variant="ghost"
                onClick={handleStartEdit}
                data-testid="button-edit-feature"
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
                  data-testid="button-save-feature"
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
        </CardHeader>
        <CardContent className="space-y-4">
          {!isEditing ? (
            <>
              {feature.description && (
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-2">Description</h3>
                  <p className="whitespace-pre-wrap" data-testid="text-description">
                    {feature.description}
                  </p>
                </div>
              )}
              
              {feature.value && (
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-2">Value (Why This Feature Matters)</h3>
                  <p className="whitespace-pre-wrap" data-testid="text-value">
                    {feature.value}
                  </p>
                </div>
              )}
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
                {feature.videoLink && (
                  <div>
                    <h3 className="text-sm font-medium text-muted-foreground mb-2">Video Demo</h3>
                    <a
                      href={feature.videoLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center text-primary hover:underline"
                      data-testid="link-video"
                    >
                      View <ExternalLink className="w-3 h-3 ml-1" />
                    </a>
                  </div>
                )}
                {feature.helpGuideLink && (
                  <div>
                    <h3 className="text-sm font-medium text-muted-foreground mb-2">Help Guide</h3>
                    <a
                      href={feature.helpGuideLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center text-primary hover:underline"
                      data-testid="link-help-guide"
                    >
                      View <ExternalLink className="w-3 h-3 ml-1" />
                    </a>
                  </div>
                )}
                {feature.releaseDate && (
                  <div>
                    <h3 className="text-sm font-medium text-muted-foreground mb-2">Release Date</h3>
                    <p data-testid="text-release-date">
                      {new Date(feature.releaseDate).toLocaleDateString()}
                    </p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">Description</h3>
                <Textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  placeholder="Brief description (supports bullet points and multiple lines)"
                  rows={4}
                  data-testid="input-edit-description"
                />
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">Value (Why This Feature Matters)</h3>
                <Textarea
                  value={editForm.value}
                  onChange={(e) => setEditForm({ ...editForm, value: e.target.value })}
                  placeholder="Explain why this feature matters and the value it provides"
                  rows={3}
                  data-testid="input-edit-value"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-2">Video Demo Link</h3>
                  <Input
                    value={editForm.videoLink}
                    onChange={(e) => setEditForm({ ...editForm, videoLink: e.target.value })}
                    placeholder="https://..."
                    data-testid="input-edit-videolink"
                  />
                </div>
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-2">Help Guide Link</h3>
                  <Input
                    value={editForm.helpGuideLink}
                    onChange={(e) => setEditForm({ ...editForm, helpGuideLink: e.target.value })}
                    placeholder="https://..."
                    data-testid="input-edit-helpguidelink"
                  />
                </div>
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-2">Release Date</h3>
                  <Input
                    type="date"
                    value={editForm.releaseDate ? new Date(editForm.releaseDate).toISOString().split('T')[0] : ""}
                    onChange={(e) => {
                      const value = e.target.value.trim();
                      setEditForm({ ...editForm, releaseDate: value ? new Date(value) : null });
                    }}
                    data-testid="input-edit-releasedate"
                  />
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {feature.categoryId && (
        <div>
          <h2 className="text-xl font-semibold mb-4">
            Related Insights from {feature.categoryName}
          </h2>
          {isLoadingInsights ? (
            <div className="text-center py-12 text-muted-foreground">Loading insights...</div>
          ) : insights.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No insights found for this category yet.
            </div>
          ) : (
            <ProductInsightsTable insights={insights} />
          )}
        </div>
      )}

      {!feature.categoryId && (
        <div className="text-center py-12 text-muted-foreground">
          This feature is not linked to a category. Link it to a category to see related insights.
        </div>
      )}
    </div>
  );
}
