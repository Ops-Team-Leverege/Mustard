import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkles, Loader2, Plus, X, User, Check, ChevronsUpDown, FileText, StickyNote, Upload, Link2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import type { Company } from "@shared/schema";
import { cn } from "@/lib/utils";

type Product = "PitCrew" | "AutoTrace" | "WorkWatch";

interface User {
  id: string;
  email: string | null;
  currentProduct: Product;
}

interface TranscriptFormProps {
  onSubmit?: (data: TranscriptData) => void;
  isAnalyzing?: boolean;
}

export interface Customer {
  name: string;
  nameInTranscript?: string;
  jobTitle: string;
}

export interface TranscriptData {
  companyName: string;
  name?: string;
  meetingDate?: string;
  contentType?: "transcript" | "notes";
  transcript: string;
  supportingMaterials?: string;
  leverageTeam: string;
  customerNames: string;
  customers?: Customer[];
  companyDescription?: string;
  numberOfStores?: string;
  serviceTags?: string[];
  contactJobTitle?: string;
  mainMeetingTakeaways?: string;
}

const LEVEREGE_TEAM_OPTIONS = [
  "Calum McClelland",
  "Hannah White",
  "Steven Lee",
  "Corey Redd",
  "Julia Conn",
  "Eric Conn",
  "Ryan Chacon",
  "Kevin Moran"
];

export default function TranscriptForm({ onSubmit, isAnalyzing = false }: TranscriptFormProps) {
  const [contentType, setContentType] = useState<"transcript" | "notes">("transcript");
  const [supportingInputMethod, setSupportingInputMethod] = useState<"file" | "url">("file");
  const [fileUrl, setFileUrl] = useState("");
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const { toast } = useToast();

  const { data: user } = useQuery<User>({
    queryKey: ["/api/auth/user"],
  });
  const [formData, setFormData] = useState<TranscriptData>({
    companyName: '',
    name: '',
    meetingDate: '',
    contentType: 'transcript',
    transcript: '',
    supportingMaterials: '',
    leverageTeam: '',
    customerNames: '',
    companyDescription: '',
    numberOfStores: '',
    serviceTags: [],
    contactJobTitle: '',
    mainMeetingTakeaways: '',
  });

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [newCustomer, setNewCustomer] = useState<Customer>({ name: '', nameInTranscript: '', jobTitle: '' });
  const [companySearchOpen, setCompanySearchOpen] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState<string[]>([]);
  const [teamSearchOpen, setTeamSearchOpen] = useState(false);
  const [teamSearchValue, setTeamSearchValue] = useState('');
  const [existingContactOpen, setExistingContactOpen] = useState(false);

  // Sync contentType state with formData
  useEffect(() => {
    setFormData(prev => ({ ...prev, contentType }));
  }, [contentType]);

  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ['/api/companies'],
  });

  const { data: companyContacts = [] } = useQuery<any[]>({
    queryKey: ['/api/contacts/company', selectedCompanyId],
    enabled: !!selectedCompanyId,
  });

  const handleAddCustomer = () => {
    if (!newCustomer.name.trim()) return;
    setCustomers([...customers, newCustomer]);
    setNewCustomer({ name: '', nameInTranscript: '', jobTitle: '' });
  };

  const handleAddExistingContact = (contact: any) => {
    // Check if contact is already added
    const alreadyAdded = customers.some(c => c.name === contact.name);
    if (alreadyAdded) return;
    
    const newContactData: Customer = {
      name: contact.name,
      nameInTranscript: contact.nameInTranscript || '',
      jobTitle: contact.jobTitle || '',
    };
    setCustomers([...customers, newContactData]);
    setExistingContactOpen(false);
  };

  const handleRemoveCustomer = (index: number) => {
    setCustomers(customers.filter((_, i) => i !== index));
  };

  const handleUpdateCustomer = (index: number, field: keyof Customer, value: string) => {
    const updatedCustomers = [...customers];
    updatedCustomers[index] = { ...updatedCustomers[index], [field]: value };
    setCustomers(updatedCustomers);
  };

  const handleAddTeamMember = (name: string) => {
    if (name.trim() && !teamMembers.includes(name.trim())) {
      setTeamMembers([...teamMembers, name.trim()]);
      setTeamSearchValue('');
    }
  };

  const handleRemoveTeamMember = (name: string) => {
    setTeamMembers(teamMembers.filter(m => m !== name));
  };

  const availableTeamOptions = LEVEREGE_TEAM_OPTIONS.filter(
    option => !teamMembers.includes(option)
  );

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessingFile(true);
    const formDataToSend = new FormData();
    formDataToSend.append('file', file);

    try {
      const response = await fetch('/api/extract-text-from-file', {
        method: 'POST',
        body: formDataToSend,
      });

      if (!response.ok) {
        throw new Error('Failed to process file');
      }

      const data = await response.json();
      
      setFormData(prev => ({ ...prev, supportingMaterials: data.text }));

      toast({
        title: "Supporting materials added",
        description: `Extracted ${data.text.length} characters from ${file.name}`,
      });
    } catch (error) {
      toast({
        title: "Error processing file",
        description: error instanceof Error ? error.message : "Unknown error occurred",
        variant: "destructive",
      });
    } finally {
      setIsProcessingFile(false);
    }
  };

  const handleUrlFetch = async () => {
    if (!fileUrl.trim()) return;

    setIsProcessingFile(true);

    try {
      const response = await fetch('/api/extract-text-from-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: fileUrl }),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch content from URL');
      }

      const data = await response.json();
      
      setFormData(prev => ({ ...prev, supportingMaterials: data.text }));

      toast({
        title: "Supporting materials added",
        description: `Extracted ${data.text.length} characters from URL`,
      });
      
      setFileUrl("");
    } catch (error) {
      toast({
        title: "Error fetching URL",
        description: error instanceof Error ? error.message : "Unknown error occurred",
        variant: "destructive",
      });
    } finally {
      setIsProcessingFile(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.companyName.trim()) {
      return;
    }
    
    if (customers.length === 0) {
      return;
    }
    
    // For transcripts, require transcript field. For notes, require mainMeetingTakeaways
    if (contentType === "transcript" && !formData.transcript.trim()) {
      return;
    }
    
    if (contentType === "notes" && !formData.mainMeetingTakeaways?.trim()) {
      return;
    }
    
    if (teamMembers.length === 0) {
      return;
    }
    
    // Convert customers array to comma-separated names for backward compatibility
    const customerNames = customers.map(c => c.name).join(', ');
    const leverageTeamString = teamMembers.join(', ');
    
    const submissionData = {
      ...formData,
      contentType,
      leverageTeam: leverageTeamString,
      customerNames,
      customers,
      // For notes mode, use mainMeetingTakeaways as the transcript content
      transcript: contentType === "notes" ? (formData.mainMeetingTakeaways || '') : formData.transcript,
    };
    
    onSubmit?.(submissionData);
  };

  return (
    <Card className="max-w-4xl mx-auto">
      <CardHeader>
        <CardTitle className="text-2xl font-semibold">
          {contentType === "transcript" ? "Add New Transcript" : "Add Meeting Notes"}
        </CardTitle>
        <CardDescription>
          {contentType === "transcript" 
            ? "Upload BD call transcript to extract product insights and customer questions"
            : "Upload meeting notes from an onsite visit to extract product insights and customer questions"}
        </CardDescription>
        
        <div className="flex items-center space-x-4 pt-4 border-t mt-4">
          <div className="flex items-center space-x-3 flex-1">
            <div className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-md transition-colors",
              contentType === "transcript" ? "bg-primary/10 text-primary" : "text-muted-foreground"
            )}>
              <FileText className="h-4 w-4" />
              <span className="text-sm font-medium">Transcript</span>
            </div>
            
            <Switch
              checked={contentType === "notes"}
              onCheckedChange={(checked) => setContentType(checked ? "notes" : "transcript")}
              data-testid="switch-content-type"
            />
            
            <div className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-md transition-colors",
              contentType === "notes" ? "bg-primary/10 text-primary" : "text-muted-foreground"
            )}>
              <StickyNote className="h-4 w-4" />
              <span className="text-sm font-medium">Meeting Notes</span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label data-testid="label-company-name">Company Name <span className="text-destructive">*</span></Label>
            <Popover open={companySearchOpen} onOpenChange={setCompanySearchOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={companySearchOpen}
                  className="w-full justify-between"
                  data-testid="button-company-selector"
                >
                  {formData.companyName || "Select or enter company name..."}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-full p-0" align="start">
                <Command>
                  <CommandInput 
                    placeholder="Search or type new company..." 
                    value={formData.companyName}
                    onValueChange={(value) => setFormData({ ...formData, companyName: value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        setCompanySearchOpen(false);
                      }
                    }}
                    data-testid="input-company-search"
                  />
                  <CommandList>
                    <CommandEmpty>
                      Press Enter to use "{formData.companyName}"
                    </CommandEmpty>
                    <CommandGroup>
                      {companies.map((company) => (
                        <CommandItem
                          key={company.id}
                          value={company.name}
                          onSelect={() => {
                            setFormData({ 
                              ...formData, 
                              companyName: company.name,
                              companyDescription: company.companyDescription || '',
                              numberOfStores: company.numberOfStores || '',
                              serviceTags: company.serviceTags || []
                            });
                            setSelectedCompanyId(company.id);
                            setCompanySearchOpen(false);
                          }}
                          data-testid={`option-company-${company.id}`}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              formData.companyName === company.name ? "opacity-100" : "opacity-0"
                            )}
                          />
                          {company.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <p className="text-xs text-muted-foreground">
              Select an existing company or type a new one
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="meetingName" data-testid="label-meeting-name">Meeting Name</Label>
            <Input
              id="meetingName"
              data-testid="input-meeting-name"
              placeholder="e.g., BD Intro Call, Weekly Customer Meeting, User Interview"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Optional name to identify this transcript
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="meetingDate" data-testid="label-meeting-date">Meeting Date</Label>
            <Input
              id="meetingDate"
              type="date"
              data-testid="input-meeting-date"
              value={formData.meetingDate}
              onChange={(e) => setFormData({ ...formData, meetingDate: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Optional date when the meeting took place
            </p>
          </div>

          {contentType === "transcript" && (
            <div className="space-y-2">
              <Label htmlFor="transcript" data-testid="label-transcript">Transcript <span className="text-destructive">*</span></Label>
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
          )}

          <div className="space-y-2">
            <Label htmlFor="mainMeetingTakeaways" data-testid="label-main-meeting-takeaways">
              {contentType === "notes" ? "Meeting Notes" : "Main Meeting Takeaways"}
              {contentType === "notes" && <span className="text-destructive"> *</span>}
            </Label>
            
            {contentType === "notes" ? (
              <Textarea
                id="mainMeetingTakeaways"
                data-testid="input-main-meeting-takeaways"
                placeholder="Paste your meeting notes here - they can be brief, informal, or fragmented. The AI will extract insights and questions from them."
                className="min-h-[200px] font-mono text-sm"
                value={formData.mainMeetingTakeaways}
                onChange={(e) => setFormData({ ...formData, mainMeetingTakeaways: e.target.value })}
                required={contentType === "notes"}
              />
            ) : (
              <Textarea
                id="mainMeetingTakeaways"
                data-testid="input-main-meeting-takeaways"
                placeholder="Add your general thoughts on the opportunity, the receptiveness of the customer, and anything else that we wouldn't be able to gather or understand just from the transcript"
                className="min-h-[100px]"
                value={formData.mainMeetingTakeaways}
                onChange={(e) => setFormData({ ...formData, mainMeetingTakeaways: e.target.value })}
              />
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="supportingMaterials" data-testid="label-supporting-materials">Supporting Materials (Optional)</Label>
            <p className="text-xs text-muted-foreground">
              Upload a deck, document, or other materials that support this call (e.g., presentation slides, product specs)
            </p>
            <Tabs defaultValue="file" value={supportingInputMethod} onValueChange={(v) => setSupportingInputMethod(v as "file" | "url")}>
              <TabsList className="grid w-full grid-cols-2" data-testid="tabs-supporting-input-method">
                <TabsTrigger value="file" data-testid="tab-supporting-file">
                  <Upload className="h-4 w-4 mr-2" />
                  Upload File
                </TabsTrigger>
                <TabsTrigger value="url" data-testid="tab-supporting-url">
                  <Link2 className="h-4 w-4 mr-2" />
                  From URL
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="file" className="mt-2">
                <div className="border-2 border-dashed rounded-md p-6 text-center space-y-3">
                  <Upload className="h-10 w-10 mx-auto text-muted-foreground" />
                  <div>
                    <Label htmlFor="supporting-file-upload" className="cursor-pointer">
                      <span className="text-primary hover:underline">Choose a file</span>
                      <span className="text-muted-foreground"> or drag and drop</span>
                    </Label>
                    <p className="text-xs text-muted-foreground mt-2">
                      Supports .txt, .docx, .pdf files
                    </p>
                    <Input
                      id="supporting-file-upload"
                      type="file"
                      accept=".txt,.docx,.pdf"
                      onChange={handleFileUpload}
                      className="hidden"
                      data-testid="input-supporting-file"
                      disabled={isProcessingFile}
                    />
                  </div>
                  {isProcessingFile && (
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm text-muted-foreground">Processing file...</span>
                    </div>
                  )}
                </div>
              </TabsContent>
              
              <TabsContent value="url" className="mt-2">
                <div className="space-y-3">
                  <Input
                    type="url"
                    placeholder="https://docs.google.com/... or any text URL"
                    value={fileUrl}
                    onChange={(e) => setFileUrl(e.target.value)}
                    data-testid="input-supporting-url"
                    disabled={isProcessingFile}
                  />
                  <Button
                    type="button"
                    onClick={handleUrlFetch}
                    disabled={!fileUrl.trim() || isProcessingFile}
                    className="w-full"
                    data-testid="button-fetch-supporting-url"
                  >
                    {isProcessingFile ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Fetching...
                      </>
                    ) : (
                      <>
                        <Link2 className="h-4 w-4 mr-2" />
                        Fetch Content
                      </>
                    )}
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
            {formData.supportingMaterials && (
              <div className="mt-2 p-3 bg-muted rounded-md">
                <p className="text-xs text-muted-foreground mb-1">Supporting materials added ({formData.supportingMaterials.length} characters)</p>
                <p className="text-xs font-mono line-clamp-2">{formData.supportingMaterials.substring(0, 200)}...</p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label data-testid="label-leverage-team">Leverege Team Members <span className="text-destructive">*</span></Label>
            
            <Popover open={teamSearchOpen} onOpenChange={setTeamSearchOpen}>
              <PopoverTrigger asChild>
                <div 
                  className="min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm cursor-pointer hover-elevate"
                  data-testid="button-team-selector"
                >
                  {teamMembers.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {teamMembers.map((member) => (
                        <Badge 
                          key={member} 
                          variant="secondary" 
                          className="gap-1"
                          data-testid={`badge-team-${member.replace(/\s+/g, '-').toLowerCase()}`}
                        >
                          {member}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveTeamMember(member);
                            }}
                            className="ml-1 hover:text-destructive"
                            data-testid={`button-remove-team-${member.replace(/\s+/g, '-').toLowerCase()}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">Select team members...</span>
                  )}
                </div>
              </PopoverTrigger>
              <PopoverContent className="w-full p-0" align="start">
                <Command>
                  <CommandInput 
                    placeholder="Search or type name..." 
                    value={teamSearchValue}
                    onValueChange={setTeamSearchValue}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && teamSearchValue.trim()) {
                        e.preventDefault();
                        handleAddTeamMember(teamSearchValue);
                        setTeamSearchOpen(false);
                      }
                    }}
                    data-testid="input-team-search"
                  />
                  <CommandList>
                    {availableTeamOptions.length === 0 && !teamSearchValue.trim() ? (
                      <CommandEmpty>All team members selected</CommandEmpty>
                    ) : (
                      <>
                        {teamSearchValue.trim() && !LEVEREGE_TEAM_OPTIONS.includes(teamSearchValue.trim()) && (
                          <CommandGroup heading="Custom">
                            <CommandItem
                              onSelect={() => {
                                handleAddTeamMember(teamSearchValue);
                                setTeamSearchOpen(false);
                              }}
                              data-testid="option-team-custom"
                            >
                              <Plus className="mr-2 h-4 w-4" />
                              Add "{teamSearchValue}"
                            </CommandItem>
                          </CommandGroup>
                        )}
                        {availableTeamOptions.length > 0 && (
                          <CommandGroup heading="Team Members">
                            {availableTeamOptions.map((member) => (
                              <CommandItem
                                key={member}
                                value={member}
                                onSelect={() => {
                                  handleAddTeamMember(member);
                                  setTeamSearchOpen(false);
                                }}
                                data-testid={`option-team-${member.replace(/\s+/g, '-').toLowerCase()}`}
                              >
                                <User className="mr-2 h-4 w-4" />
                                {member}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        )}
                      </>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            
            <p className="text-xs text-muted-foreground">
              Select from the list or type a custom name
            </p>
          </div>

          <div className="space-y-3">
            <Label data-testid="label-customers">Customer Attendees <span className="text-destructive">*</span></Label>
            
            <div className="border rounded-md p-4 space-y-3 bg-muted/30">
              <div className="grid grid-cols-1 sm:grid-cols-[1fr,1fr,1fr,auto] gap-3 items-end">
                <div>
                  <label className="text-sm font-medium mb-1 block">Name</label>
                  <Input
                    value={newCustomer.name}
                    onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                    placeholder="e.g., Mike Chen"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddCustomer();
                      }
                    }}
                    data-testid="input-new-customer-name"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Name in Transcript (optional)</label>
                  <Input
                    value={newCustomer.nameInTranscript}
                    onChange={(e) => setNewCustomer({ ...newCustomer, nameInTranscript: e.target.value })}
                    placeholder="e.g., Mike"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddCustomer();
                      }
                    }}
                    data-testid="input-new-customer-name-in-transcript"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Job Title (optional)</label>
                  <Input
                    value={newCustomer.jobTitle}
                    onChange={(e) => setNewCustomer({ ...newCustomer, jobTitle: e.target.value })}
                    placeholder="e.g., VP of Operations"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddCustomer();
                      }
                    }}
                    data-testid="input-new-customer-job-title"
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleAddCustomer}
                  disabled={!newCustomer.name.trim()}
                  data-testid="button-add-customer"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add
                </Button>
              </div>
            </div>

            {selectedCompanyId && companyContacts.length > 0 && (
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">Or</span>
                </div>
              </div>
            )}

            {selectedCompanyId && companyContacts.length > 0 && (
              <Popover open={existingContactOpen} onOpenChange={setExistingContactOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={existingContactOpen}
                    className="w-full justify-between"
                    data-testid="button-add-existing-contact"
                  >
                    Add an existing contact
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0" align="start">
                  <Command>
                    <CommandInput 
                      placeholder="Search contacts..." 
                      data-testid="input-existing-contact-search"
                    />
                    <CommandList>
                      <CommandEmpty>No contacts found</CommandEmpty>
                      <CommandGroup>
                        {companyContacts
                          .filter(contact => !customers.some(c => c.name === contact.name))
                          .map((contact) => (
                            <CommandItem
                              key={contact.id}
                              value={contact.name}
                              onSelect={() => handleAddExistingContact(contact)}
                              data-testid={`option-existing-contact-${contact.id}`}
                            >
                              <User className="mr-2 h-4 w-4" />
                              <div className="flex flex-col">
                                <span>{contact.name}</span>
                                {contact.jobTitle && (
                                  <span className="text-xs text-muted-foreground">{contact.jobTitle}</span>
                                )}
                              </div>
                            </CommandItem>
                          ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            )}

            {customers.length > 0 ? (
              <div className="space-y-3">
                {customers.map((customer, index) => (
                  <div
                    key={index}
                    className="border rounded-md p-3 bg-background space-y-3"
                    data-testid={`customer-item-${index}`}
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr,1fr,1fr,auto] gap-3 items-end">
                      <div>
                        <label className="text-sm font-medium mb-1 block">Name</label>
                        <Input
                          value={customer.name}
                          onChange={(e) => handleUpdateCustomer(index, 'name', e.target.value)}
                          placeholder="e.g., Mike Chen"
                          data-testid={`input-customer-name-${index}`}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1 block">Name in Transcript (optional)</label>
                        <Input
                          value={customer.nameInTranscript || ''}
                          onChange={(e) => handleUpdateCustomer(index, 'nameInTranscript', e.target.value)}
                          placeholder="e.g., Mike"
                          data-testid={`input-customer-name-in-transcript-${index}`}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1 block">Job Title (optional)</label>
                        <Input
                          value={customer.jobTitle || ''}
                          onChange={(e) => handleUpdateCustomer(index, 'jobTitle', e.target.value)}
                          placeholder="e.g., VP of Operations"
                          data-testid={`input-customer-job-title-${index}`}
                        />
                      </div>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => handleRemoveCustomer(index)}
                        data-testid={`button-remove-customer-${index}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                Add at least one customer who attended this call
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="companyDescription" data-testid="label-company-description">Company Description</Label>
            <Textarea
              id="companyDescription"
              data-testid="input-company-description"
              placeholder="Include what services they provide, any operational differences than what we normally see, whether it's corporate or franchise owned, and anything else that would be hard to discover online"
              className="min-h-[100px]"
              value={formData.companyDescription}
              onChange={(e) => setFormData({ ...formData, companyDescription: e.target.value })}
            />
          </div>

          {user?.currentProduct === "PitCrew" && (
            <div className="space-y-3">
              <Label data-testid="label-service-tags">Service Tags</Label>
              <div className="space-y-2">
                {["tire services", "oil & express services", "commercial truck services", "full services"].map((tag) => (
                  <div key={tag} className="flex items-center space-x-2">
                    <Checkbox
                      id={`service-tag-${tag}`}
                      checked={formData.serviceTags?.includes(tag)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setFormData({ ...formData, serviceTags: [...(formData.serviceTags || []), tag] });
                        } else {
                          setFormData({ ...formData, serviceTags: formData.serviceTags?.filter(t => t !== tag) || [] });
                        }
                      }}
                      data-testid={`checkbox-service-tag-${tag}`}
                    />
                    <Label htmlFor={`service-tag-${tag}`} className="text-sm font-normal cursor-pointer">
                      {tag}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          )}

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

          <Button
            type="submit"
            className="w-full"
            disabled={
              isAnalyzing || 
              customers.length === 0 || 
              !formData.companyName.trim() || 
              teamMembers.length === 0 ||
              (contentType === "transcript" && !formData.transcript.trim()) ||
              (contentType === "notes" && !formData.mainMeetingTakeaways?.trim())
            }
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
                {contentType === "transcript" ? "Analyze Transcript" : "Analyze Meeting Notes"}
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
