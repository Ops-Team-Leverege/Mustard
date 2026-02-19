import { useQuery } from "@tanstack/react-query";
import QATable from "@/components/QATable";

interface User {
  id: string;
  email: string | null;
  currentProduct: string;
}

export default function QADatabase() {
  const { data: user } = useQuery<User>({
    queryKey: ["/api/auth/user"],
  });

  const isAllActivity = user?.currentProduct === "All Activity";

  const { data: qaPairs = [], isLoading } = useQuery<any[]>({
    queryKey: ['/api/qa-pairs'],
  });

  const { data: categories = [] } = useQuery<any[]>({
    queryKey: ['/api/categories'],
  });

  const categoryObjects = (categories as any[]).map((cat: any) => ({
    id: cat.id,
    name: cat.name,
  }));

  return (
    <div className="container mx-auto py-6 sm:py-8 px-4 sm:px-6">
      <div className="mb-4 sm:mb-6">
        <h1 className="text-2xl sm:text-3xl font-semibold">Customer Q&A Database</h1>
        <p className="text-muted-foreground mt-1">
          Product-specific questions and BD answers
        </p>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading Q&A pairs...</div>
      ) : (
        <QATable qaPairs={qaPairs as any[]} categories={categoryObjects} isAllActivity={isAllActivity} />
      )}
    </div>
  );
}
