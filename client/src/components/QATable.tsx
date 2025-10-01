import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

export interface QAPair {
  id: string;
  question: string;
  answer: string;
  asker: string;
  company: string;
}

interface QATableProps {
  qaPairs: QAPair[];
}

export default function QATable({ qaPairs }: QATableProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredQAPairs = qaPairs.filter(qa => {
    return (
      qa.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      qa.answer.toLowerCase().includes(searchQuery.toLowerCase()) ||
      qa.asker.toLowerCase().includes(searchQuery.toLowerCase()) ||
      qa.company.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search questions or answers..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
          data-testid="input-search-qa"
        />
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[300px]">Question</TableHead>
              <TableHead>Answer</TableHead>
              <TableHead className="w-[150px]">Asked By</TableHead>
              <TableHead className="w-[150px]">Company</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredQAPairs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                  No Q&A pairs found
                </TableCell>
              </TableRow>
            ) : (
              filteredQAPairs.map((qa) => (
                <TableRow key={qa.id} data-testid={`row-qa-${qa.id}`}>
                  <TableCell className="font-medium" data-testid={`text-question-${qa.id}`}>
                    {qa.question}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {qa.answer}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="font-normal" data-testid={`badge-asker-${qa.id}`}>
                      {qa.asker}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-normal" data-testid={`badge-company-${qa.id}`}>
                      {qa.company}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
