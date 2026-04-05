import SwiftUI

struct KnowledgeView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = KnowledgeViewModel()

    var body: some View {
        NavigationStack {
            Group {
                if viewModel.isLoading && viewModel.knowledgeBases.isEmpty {
                    LoadingView()
                } else if viewModel.knowledgeBases.isEmpty {
                    emptyState
                } else {
                    contentView
                }
            }
            .navigationTitle("Knowledge Base")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button {
                            viewModel.showAddKBSheet = true
                        } label: {
                            Label("New Knowledge Base", systemImage: "folder.badge.plus")
                        }
                        if viewModel.selectedKB != nil {
                            Button {
                                viewModel.showAddFAQSheet = true
                            } label: {
                                Label("Add FAQ", systemImage: "plus.bubble")
                            }
                        }
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $viewModel.showAddKBSheet) {
                AddKnowledgeBaseSheet(viewModel: viewModel, tenantId: appState.tenantId ?? "")
            }
            .sheet(isPresented: $viewModel.showAddFAQSheet) {
                AddFAQSheet(viewModel: viewModel, tenantId: appState.tenantId ?? "")
            }
            .refreshable {
                if let tenantId = appState.tenantId {
                    await viewModel.loadKnowledgeBases(tenantId: tenantId)
                }
            }
            .task {
                if let tenantId = appState.tenantId {
                    await viewModel.loadKnowledgeBases(tenantId: tenantId)
                }
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "book.closed")
                .font(.largeTitle)
                .foregroundStyle(.tertiary)
            Text("No knowledge bases yet")
                .font(.headline)
            Text("Add FAQs and business info so your AI can answer questions accurately")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            PrimaryButton(title: "Create Knowledge Base") {
                viewModel.showAddKBSheet = true
            }
            .padding(.horizontal, 48)
        }
    }

    private var contentView: some View {
        List {
            // KB selector
            if viewModel.knowledgeBases.count > 1 {
                Section {
                    ForEach(viewModel.knowledgeBases) { kb in
                        Button {
                            viewModel.selectKB(kb)
                        } label: {
                            HStack {
                                Image(systemName: sourceTypeIcon(kb.sourceType))
                                    .foregroundStyle(Color.brand)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(kb.name)
                                        .font(.body)
                                    Text(kb.sourceType.capitalized)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                if kb.id == viewModel.selectedKB?.id {
                                    Image(systemName: "checkmark")
                                        .foregroundStyle(Color.brand)
                                }
                            }
                        }
                        .foregroundStyle(.primary)
                    }
                } header: {
                    Text("Knowledge Bases")
                }
            }

            // FAQ items
            Section {
                if viewModel.items.isEmpty {
                    VStack(spacing: 8) {
                        Text("No FAQs yet")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Button("Add FAQ") {
                            viewModel.showAddFAQSheet = true
                        }
                        .font(.subheadline)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                } else {
                    ForEach(viewModel.items) { item in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(alignment: .top) {
                                Image(systemName: "questionmark.circle.fill")
                                    .foregroundStyle(Color.brand)
                                    .font(.body)
                                Text(item.question)
                                    .font(.body)
                                    .fontWeight(.medium)
                            }
                            HStack(alignment: .top) {
                                Image(systemName: "text.bubble.fill")
                                    .foregroundStyle(.secondary)
                                    .font(.body)
                                Text(item.answer)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
            } header: {
                if let kb = viewModel.selectedKB {
                    Text("\(kb.name) — FAQs")
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private func sourceTypeIcon(_ type: String) -> String {
        switch type {
        case "website": return "globe"
        case "pdf": return "doc.fill"
        default: return "text.book.closed"
        }
    }
}

struct AddKnowledgeBaseSheet: View {
    @Bindable var viewModel: KnowledgeViewModel
    let tenantId: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Name") {
                    TextField("e.g. Business FAQs", text: $viewModel.newKBName)
                }
                Section("Source Type") {
                    Picker("Type", selection: $viewModel.newKBSourceType) {
                        Text("Manual Q&A").tag("manual")
                        Text("Website").tag("website")
                    }
                    .pickerStyle(.segmented)

                    if viewModel.newKBSourceType == "website" {
                        TextField("https://www.example.com", text: $viewModel.newKBSourceUrl)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                    }
                }
            }
            .navigationTitle("New Knowledge Base")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        Task { await viewModel.createKnowledgeBase(tenantId: tenantId) }
                    }
                    .disabled(viewModel.newKBName.trimmingCharacters(in: .whitespaces).isEmpty || viewModel.isCreatingKB)
                }
            }
        }
        .presentationDetents([.medium])
    }
}

struct AddFAQSheet: View {
    @Bindable var viewModel: KnowledgeViewModel
    let tenantId: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Question") {
                    TextField("What do callers ask?", text: $viewModel.newQuestion, axis: .vertical)
                        .lineLimit(2...4)
                }
                Section("Answer") {
                    TextField("How should your AI respond?", text: $viewModel.newAnswer, axis: .vertical)
                        .lineLimit(3...6)
                }
            }
            .navigationTitle("Add FAQ")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        Task { await viewModel.addFAQ(tenantId: tenantId) }
                    }
                    .disabled(
                        viewModel.newQuestion.trimmingCharacters(in: .whitespaces).isEmpty ||
                        viewModel.newAnswer.trimmingCharacters(in: .whitespaces).isEmpty ||
                        viewModel.isAddingFAQ
                    )
                }
            }
        }
        .presentationDetents([.medium])
    }
}
