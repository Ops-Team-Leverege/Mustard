import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import ProductInsightsTable from "@/components/ProductInsightsTable";
import QATable from "@/components/QATable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Pencil, Check, X, Plus, Trash2, User, FileText, Calendar, Eye } from "lucide-react";
import { useState } from "react";
import { format, parseISO } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { CompanyOverview, Contact } from "@shared/schema";

export default function CompanyPage() {
  const params = useParams();
  const companySlug = params.slug;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    name: '',
    companyDescription: '',
    mainInterestAreas: '',
    numberOfStores: '',
    stage: '',
  });

  const [isAddingContact, setIsAddingContact] = useState(false);
  const [newContact, setNewContact] = useState({ name: '', nameInTranscript: '', jobTitle: '' });
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [editContactForm, setEditContactForm] = useState({ name: '', nameInTranscript: '', jobTitle: '' });
  const [activeTab, setActiveTab] = useState("insights");
  const [editingTranscriptId, setEditingTranscriptId] = useState<string | null>(null);
  const [editTranscriptName, setEditTranscriptName] = useState('');
  const [editTranscriptDate, setEditTranscriptDate] = useState('');
  const [viewingTranscript, setViewingTranscript] = useState<any | null>(null);

  const { data: overview, isLoading } = useQuery<CompanyOverview>({
    queryKey: [`/api/companies/${companySlug}/overview`],
    enabled: !!companySlug,
  });

  const { data: categories = [] } = useQuery<Array<{ id: string; name: string; description?: string }>>({
    queryKey: ['/api/categories'],
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { name: string; companyDescription: string; mainInterestAreas: string; numberOfStores: string; stage: string }) => {
      if (!overview?.company.id) throw new Error("Company not found");
      const res = await apiRequest('PATCH', `/api/companies/${overview.company.id}`, {
        name: data.name,
        notes: overview.company.notes,
        companyDescription: data.companyDescription,
        mainInterestAreas: data.mainInterestAreas,
        numberOfStores: data.numberOfStores,
        stage: data.stage || null,
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

  const createContactMutation = useMutation({
    mutationFn: async (data: { name: string; nameInTranscript: string; jobTitle: string }) => {
      if (!overview?.company.id) throw new Error("Company not found");
      const res = await apiRequest('POST', '/api/contacts', {
        name: data.name,
        nameInTranscript: data.nameInTranscript || null,
        jobTitle: data.jobTitle || null,
        companyId: overview.company.id,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && (key.startsWith('/api/companies') || key.startsWith('/api/qa-pairs'));
        }
      });
      setIsAddingContact(false);
      setNewContact({ name: '', nameInTranscript: '', jobTitle: '' });
      toast({
        title: "Success",
        description: "Contact added successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add contact",
        variant: "destructive",
      });
    },
  });

  const updateContactMutation = useMutation({
    mutationFn: async ({ id, name, nameInTranscript, jobTitle }: { id: string; name: string; nameInTranscript: string; jobTitle: string }) => {
      const res = await apiRequest('PATCH', `/api/contacts/${id}`, {
        name,
        nameInTranscript: nameInTranscript || null,
        jobTitle: jobTitle || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && (key.startsWith('/api/companies') || key.startsWith('/api/qa-pairs'));
        }
      });
      setEditingContactId(null);
      setEditContactForm({ name: '', nameInTranscript: '', jobTitle: '' });
      toast({
        title: "Success",
        description: "Contact updated successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update contact",
        variant: "destructive",
      });
    },
  });

  const deleteContactMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('DELETE', `/api/contacts/${id}`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && (key.startsWith('/api/companies') || key.startsWith('/api/qa-pairs'));
        }
      });
      toast({
        title: "Success",
        description: "Contact deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete contact",
        variant: "destructive",
      });
    },
  });

  const updateTranscriptMutation = useMutation({
    mutationFn: async ({ id, name, createdAt }: { id: string; name?: string; createdAt?: string }) => {
      const res = await apiRequest('PATCH', `/api/transcripts/${id}`, { name, createdAt });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companySlug}/overview`] });
      setEditingTranscriptId(null);
      setEditTranscriptName('');
      setEditTranscriptDate('');
      toast({
        title: "Success",
        description: "Transcript updated successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update transcript",
        variant: "destructive",
      });
    },
  });

  const deleteCompanyMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('DELETE', `/api/companies/${id}`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies'] });
      toast({
        title: "Success",
        description: "Company deleted successfully",
      });
      navigate('/companies');
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete company",
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
      name: overview?.company.name || '',
      companyDescription: overview?.company.companyDescription || '',
      mainInterestAreas: overview?.company.mainInterestAreas || '',
      numberOfStores: overview?.company.numberOfStores || '',
      stage: overview?.company.stage || '',
    });
    setIsEditing(true);
  };

  const handleSave = () => {
    updateMutation.mutate(editForm);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditForm({
      name: '',
      companyDescription: '',
      mainInterestAreas: '',
      numberOfStores: '',
      stage: '',
    });
  };

  const handleAddContact = () => {
    if (!newContact.name.trim()) return;
    createContactMutation.mutate(newContact);
  };

  const handleStartEditContact = (contact: Contact) => {
    setEditingContactId(contact.id);
    setEditContactForm({ name: contact.name, nameInTranscript: contact.nameInTranscript || '', jobTitle: contact.jobTitle || '' });
  };

  const handleSaveContact = () => {
    if (!editingContactId || !editContactForm.name.trim()) return;
    updateContactMutation.mutate({
      id: editingContactId,
      name: editContactForm.name,
      nameInTranscript: editContactForm.nameInTranscript,
      jobTitle: editContactForm.jobTitle,
    });
  };

  const handleCancelEditContact = () => {
    setEditingContactId(null);
    setEditContactForm({ name: '', nameInTranscript: '', jobTitle: '' });
  };

  const handleDeleteContact = (id: string) => {
    if (confirm('Are you sure you want to delete this contact?')) {
      deleteContactMutation.mutate(id);
    }
  };

  const handleDeleteCompany = () => {
    if (confirm(`Are you sure you want to delete "${overview?.company.name}"? This will delete all associated transcripts, insights, Q&A pairs, and contacts. This action cannot be undone.`)) {
      if (overview?.company.id) {
        deleteCompanyMutation.mutate(overview.company.id);
      }
    }
  };

  const handleStartEditTranscript = (transcript: any) => {
    setEditingTranscriptId(transcript.id);
    setEditTranscriptName(transcript.name || '');
    // Format date for input (YYYY-MM-DD)
    setEditTranscriptDate(format(new Date(transcript.createdAt), 'yyyy-MM-dd'));
  };

  const handleSaveTranscript = () => {
    if (!editingTranscriptId || !editTranscriptName.trim()) return;
    updateTranscriptMutation.mutate({ 
      id: editingTranscriptId, 
      name: editTranscriptName.trim(),
      createdAt: editTranscriptDate ? new Date(editTranscriptDate).toISOString() : undefined,
    });
  };

  const handleCancelEditTranscript = () => {
    setEditingTranscriptId(null);
    setEditTranscriptName('');
    setEditTranscriptDate('');
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <Card>
        <CardHeader>
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                {!isEditing ? (
                  <>
                    <CardTitle className="text-2xl sm:text-3xl">{overview.company.name}</CardTitle>
                    {overview.company.notes && (
                      <CardDescription className="mt-2">{overview.company.notes}</CardDescription>
                    )}
                  </>
                ) : (
                  <div className="space-y-2">
                    <div>
                      <h3 className="text-sm font-semibold mb-1">Company Name</h3>
                      <Input
                        value={editForm.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        placeholder="Company name"
                        data-testid="input-company-name"
                        className="text-xl font-bold"
                      />
                    </div>
                    {overview.company.notes && (
                      <CardDescription>{overview.company.notes}</CardDescription>
                    )}
                  </div>
                )}
              </div>
              {!isEditing ? (
                <div className="flex gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleStartEdit}
                    data-testid="button-edit-company"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleDeleteCompany}
                    disabled={deleteCompanyMutation.isPending}
                    data-testid="button-delete-company"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
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
                  {overview.company.stage && (
                    <div>
                      <h3 className="text-sm font-semibold mb-1">Stage</h3>
                      <Badge variant="outline" data-testid="badge-stage">
                        {overview.company.stage}
                      </Badge>
                    </div>
                  )}
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
                    <h3 className="text-sm font-semibold mb-1">Stage</h3>
                    <Select
                      value={editForm.stage}
                      onValueChange={(value) => setEditForm({ ...editForm, stage: value })}
                    >
                      <SelectTrigger data-testid="select-stage">
                        <SelectValue placeholder="Select stage" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Prospect">Prospect</SelectItem>
                        <SelectItem value="Pilot">Pilot</SelectItem>
                        <SelectItem value="Rollout">Rollout</SelectItem>
                        <SelectItem value="Scale">Scale</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
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

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="insights" data-testid="tab-insights">
            Insights & Q&A
          </TabsTrigger>
          <TabsTrigger value="contacts" data-testid="tab-contacts">
            Contacts
          </TabsTrigger>
          <TabsTrigger value="transcripts" data-testid="tab-transcripts">
            Transcripts
          </TabsTrigger>
        </TabsList>

        <TabsContent value="insights" className="space-y-4">
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
                  companyId: qa.companyId || overview.company.id,
                  category: qa.categoryName || 'NEW',
                }))}
                categories={categories}
                defaultCompany={overview.company.name}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contacts">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <CardTitle>Contacts</CardTitle>
                  <CardDescription>
                    Customer contacts from {overview.company.name}
                  </CardDescription>
                </div>
            {!isAddingContact && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsAddingContact(true)}
                data-testid="button-add-contact"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Contact
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {isAddingContact && (
              <div className="border rounded-md p-4 space-y-3 bg-muted/30">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-sm font-medium mb-1 block">Name</label>
                    <Input
                      value={newContact.name}
                      onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
                      placeholder="Contact name"
                      data-testid="input-contact-name"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Name in Transcript</label>
                    <Input
                      value={newContact.nameInTranscript}
                      onChange={(e) => setNewContact({ ...newContact, nameInTranscript: e.target.value })}
                      placeholder="Name as appears in transcript"
                      data-testid="input-contact-name-in-transcript"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Job Title</label>
                    <Input
                      value={newContact.jobTitle}
                      onChange={(e) => setNewContact({ ...newContact, jobTitle: e.target.value })}
                      placeholder="e.g., VP of Engineering"
                      data-testid="input-contact-job-title"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleAddContact}
                    disabled={!newContact.name.trim() || createContactMutation.isPending}
                    data-testid="button-save-contact"
                  >
                    <Check className="h-4 w-4 mr-2" />
                    Save Contact
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setIsAddingContact(false);
                      setNewContact({ name: '', nameInTranscript: '', jobTitle: '' });
                    }}
                    disabled={createContactMutation.isPending}
                    data-testid="button-cancel-add-contact"
                  >
                    <X className="h-4 w-4 mr-2" />
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {overview.contacts && overview.contacts.length > 0 ? (
              <div className="space-y-2">
                {overview.contacts.map((contact) => (
                  <div
                    key={contact.id}
                    className="flex items-center justify-between gap-4 p-3 border rounded-md hover-elevate"
                    data-testid={`contact-${contact.id}`}
                  >
                    {editingContactId === contact.id ? (
                      <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <Input
                          value={editContactForm.name}
                          onChange={(e) => setEditContactForm({ ...editContactForm, name: e.target.value })}
                          placeholder="Contact name"
                          data-testid={`input-edit-contact-name-${contact.id}`}
                        />
                        <Input
                          value={editContactForm.nameInTranscript}
                          onChange={(e) => setEditContactForm({ ...editContactForm, nameInTranscript: e.target.value })}
                          placeholder="Name in transcript"
                          data-testid={`input-edit-contact-name-in-transcript-${contact.id}`}
                        />
                        <Input
                          value={editContactForm.jobTitle}
                          onChange={(e) => setEditContactForm({ ...editContactForm, jobTitle: e.target.value })}
                          placeholder="Job title"
                          data-testid={`input-edit-contact-job-title-${contact.id}`}
                        />
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 flex-1">
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <User className="h-4 w-4 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate" data-testid={`text-contact-name-${contact.id}`}>
                            {contact.name}
                          </p>
                          {contact.jobTitle && (
                            <p className="text-sm text-muted-foreground truncate" data-testid={`text-contact-job-title-${contact.id}`}>
                              {contact.jobTitle}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                    <div className="flex gap-1 flex-shrink-0">
                      {editingContactId === contact.id ? (
                        <>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={handleSaveContact}
                            disabled={!editContactForm.name.trim() || updateContactMutation.isPending}
                            data-testid={`button-save-edit-contact-${contact.id}`}
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={handleCancelEditContact}
                            disabled={updateContactMutation.isPending}
                            data-testid={`button-cancel-edit-contact-${contact.id}`}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleStartEditContact(contact)}
                            data-testid={`button-edit-contact-${contact.id}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleDeleteContact(contact.id)}
                            disabled={deleteContactMutation.isPending}
                            data-testid={`button-delete-contact-${contact.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              !isAddingContact && (
                <div className="text-center py-8 text-muted-foreground">
                  <User className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No contacts added yet</p>
                  <p className="text-sm mt-1">Click "Add Contact" to add customer contacts</p>
                </div>
              )
            )}
          </div>
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="transcripts">
          <Card>
            <CardHeader>
              <CardTitle>Transcripts</CardTitle>
              <CardDescription>
                Meeting transcripts from {overview.company.name}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {overview.transcripts && overview.transcripts.length > 0 ? (
                  <div className="space-y-2">
                    {overview.transcripts.map((transcript) => (
                      <div
                        key={transcript.id}
                        className="flex items-center justify-between gap-4 p-3 border rounded-md hover-elevate"
                        data-testid={`transcript-${transcript.id}`}
                      >
                        {editingTranscriptId === transcript.id ? (
                          <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <Input
                              value={editTranscriptName}
                              onChange={(e) => setEditTranscriptName(e.target.value)}
                              placeholder="Transcript name"
                              data-testid={`input-edit-transcript-name-${transcript.id}`}
                            />
                            <Input
                              type="date"
                              value={editTranscriptDate}
                              onChange={(e) => setEditTranscriptDate(e.target.value)}
                              data-testid={`input-edit-transcript-date-${transcript.id}`}
                            />
                          </div>
                        ) : (
                          <div 
                            className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
                            onClick={() => navigate(`/transcripts/${transcript.id}`)}
                            data-testid={`button-navigate-transcript-${transcript.id}`}
                          >
                            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                              <FileText className="h-4 w-4 text-primary" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate" data-testid={`text-transcript-name-${transcript.id}`}>
                                {transcript.name || 'Untitled Transcript'}
                              </p>
                              <p className="text-sm text-muted-foreground truncate" data-testid={`text-transcript-date-${transcript.id}`}>
                                <Calendar className="h-3 w-3 inline mr-1" />
                                {format(new Date(transcript.createdAt), 'MMM d, yyyy')}
                              </p>
                            </div>
                          </div>
                        )}
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {editingTranscriptId === transcript.id ? (
                            <>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={handleSaveTranscript}
                                disabled={updateTranscriptMutation.isPending || !editTranscriptName.trim()}
                                data-testid={`button-save-transcript-${transcript.id}`}
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={handleCancelEditTranscript}
                                disabled={updateTranscriptMutation.isPending}
                                data-testid={`button-cancel-edit-transcript-${transcript.id}`}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => setViewingTranscript(transcript)}
                                data-testid={`button-view-transcript-${transcript.id}`}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => handleStartEditTranscript(transcript)}
                                data-testid={`button-edit-transcript-${transcript.id}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>No transcripts yet</p>
                    <p className="text-sm mt-1">Upload transcripts to see them here</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!viewingTranscript} onOpenChange={(open) => !open && setViewingTranscript(null)}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{viewingTranscript?.name || 'Untitled Transcript'}</DialogTitle>
            <DialogDescription>
              {viewingTranscript && format(new Date(viewingTranscript.createdAt), 'MMMM d, yyyy')}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4">
            <div className="whitespace-pre-wrap text-sm p-4 bg-muted rounded-md max-h-[50vh] overflow-y-auto" data-testid="transcript-content">
              {viewingTranscript?.transcript}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
