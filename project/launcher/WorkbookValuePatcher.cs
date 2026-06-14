using System.IO.Compression;
using System.Text;
using System.Xml.Linq;

internal sealed class WorkbookValuePatchRequest
{
    public string? SheetName { get; set; }
    public List<string>? Columns { get; set; }
    public List<List<string?>>? Rows { get; set; }
    public List<string>? FormulaColumns { get; set; }
    public bool PatchColumnsOnly { get; set; }
}

internal static class WorkbookValuePatcher
{
    private static readonly XNamespace SpreadsheetNamespace =
        "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

    public static void Patch(string workbookPath, WorkbookValuePatchRequest patchRequest)
    {
        using var archive = ZipFile.Open(workbookPath, ZipArchiveMode.Update);
        var worksheetEntryPath = GetWorksheetEntryPath(archive, patchRequest.SheetName);
        var sharedStrings = LoadSharedStringTable(archive);
        var worksheetEntry = archive.GetEntry(worksheetEntryPath)
            ?? throw new InvalidOperationException("Worksheet not found.");
        XDocument worksheetDocument;

        using (var readStream = worksheetEntry.Open())
        {
            worksheetDocument = XDocument.Load(readStream, LoadOptions.PreserveWhitespace);
        }

        var worksheetChanged = PatchWorksheetDocument(
            worksheetDocument,
            patchRequest,
            sharedStrings
        );

        if (worksheetChanged)
        {
            worksheetEntry.Delete();
            var nextWorksheetEntry = archive.CreateEntry(
                worksheetEntryPath,
                CompressionLevel.Optimal
            );

            using var writeStream = nextWorksheetEntry.Open();
            using var writer = new StreamWriter(writeStream, new UTF8Encoding(false));
            writer.Write(worksheetDocument.ToString(SaveOptions.DisableFormatting));
        }

        SaveSharedStringTable(archive, sharedStrings);
    }

    private static bool PatchWorksheetDocument(
        XDocument worksheetDocument,
        WorkbookValuePatchRequest patchRequest,
        SharedStringTable sharedStrings
    )
    {
        var root = worksheetDocument.Root
            ?? throw new InvalidOperationException("Worksheet root not found.");
        var sheetData = root.Element(SpreadsheetNamespace + "sheetData");

        if (sheetData is null)
        {
            sheetData = new XElement(SpreadsheetNamespace + "sheetData");
            root.Add(sheetData);
        }

        var columns = patchRequest.Columns ?? [];
        var rows = patchRequest.Rows ?? [];
        var formulaColumns = new HashSet<string>(
            patchRequest.FormulaColumns ?? [],
            StringComparer.OrdinalIgnoreCase
        );
        var changed = false;

        if (patchRequest.PatchColumnsOnly)
        {
            return PatchWorksheetColumns(
                sheetData,
                columns,
                rows,
                formulaColumns,
                sharedStrings
            );
        }

        var nextRows = new List<List<string?>>();
        nextRows.Add(columns.Cast<string?>().ToList());
        nextRows.AddRange(rows);
        var maxRowIndex = Math.Max(
            nextRows.Count - 1,
            sheetData.Elements(SpreadsheetNamespace + "row")
                .Select(GetSpreadsheetRowIndex)
                .DefaultIfEmpty(0)
                .Max() - 1
        );
        var maxColumnIndex = columns.Count - 1;

        for (var rowIndex = 0; rowIndex <= maxRowIndex; rowIndex += 1)
        {
            var rowElement = GetOrCreateRowElement(sheetData, rowIndex);

            for (var columnIndex = 0; columnIndex <= maxColumnIndex; columnIndex += 1)
            {
                var cellReference = GetCellReference(rowIndex, columnIndex);
                var columnName = columns[columnIndex] ?? string.Empty;
                var cellElement = GetOrCreateCellElement(rowElement, cellReference);
                var hasFormula = cellElement.Element(SpreadsheetNamespace + "f") is not null;

                if (rowIndex > 0 && hasFormula && formulaColumns.Contains(columnName))
                {
                    continue;
                }

                var value = rowIndex < nextRows.Count &&
                    columnIndex < nextRows[rowIndex].Count
                    ? nextRows[rowIndex][columnIndex] ?? string.Empty
                    : string.Empty;
                var currentValue = GetCellStringValue(cellElement, sharedStrings);

                if (string.Equals(currentValue, value, StringComparison.Ordinal))
                {
                    continue;
                }

                SetCellStringValue(cellElement, value, sharedStrings);
                changed = true;
            }
        }

        return changed;
    }

    private static bool PatchWorksheetColumns(
        XElement sheetData,
        List<string> columns,
        List<List<string?>> rows,
        HashSet<string> formulaColumns,
        SharedStringTable sharedStrings
    )
    {
        if (columns.Count == 0)
        {
            return false;
        }

        var headerRow = GetOrCreateRowElement(sheetData, 0);
        var headerIndexByName = headerRow.Elements(SpreadsheetNamespace + "c")
            .Select(cell => new
            {
                ColumnIndex = GetColumnIndexFromReference(cell.Attribute("r")?.Value ?? ""),
                Name = GetCellStringValue(cell, sharedStrings),
            })
            .Where(header => header.ColumnIndex >= 0 && !string.IsNullOrWhiteSpace(header.Name))
            .GroupBy(header => header.Name, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                group => group.Key,
                group => group.First().ColumnIndex,
                StringComparer.OrdinalIgnoreCase
            );
        var targetColumnIndexes = columns
            .Select(column =>
                headerIndexByName.TryGetValue(column, out var columnIndex)
                    ? columnIndex
                    : -1
            )
            .ToList();
        var changed = false;

        for (var rowIndex = 0; rowIndex < rows.Count; rowIndex += 1)
        {
            var rowElement = GetOrCreateRowElement(sheetData, rowIndex + 1);

            for (var patchColumnIndex = 0; patchColumnIndex < columns.Count; patchColumnIndex += 1)
            {
                var targetColumnIndex = targetColumnIndexes[patchColumnIndex];

                if (targetColumnIndex < 0)
                {
                    continue;
                }

                var columnName = columns[patchColumnIndex] ?? string.Empty;
                var cellReference = GetCellReference(rowIndex + 1, targetColumnIndex);
                var cellElement = GetOrCreateCellElement(rowElement, cellReference);
                var hasFormula = cellElement.Element(SpreadsheetNamespace + "f") is not null;

                if (hasFormula && formulaColumns.Contains(columnName))
                {
                    continue;
                }

                var value = patchColumnIndex < rows[rowIndex].Count
                    ? rows[rowIndex][patchColumnIndex] ?? string.Empty
                    : string.Empty;
                var currentValue = GetCellStringValue(cellElement, sharedStrings);

                if (string.Equals(currentValue, value, StringComparison.Ordinal))
                {
                    continue;
                }

                SetCellStringValue(cellElement, value, sharedStrings);
                changed = true;
            }
        }

        return changed;
    }

    private static XElement GetOrCreateRowElement(
        XElement sheetData,
        int zeroBasedRowIndex
    )
    {
        var rowNumber = zeroBasedRowIndex + 1;
        var rowElement = sheetData.Elements(SpreadsheetNamespace + "row")
            .FirstOrDefault(row => GetSpreadsheetRowIndex(row) == rowNumber);

        if (rowElement is not null)
        {
            return rowElement;
        }

        rowElement = new XElement(
            SpreadsheetNamespace + "row",
            new XAttribute("r", rowNumber)
        );
        var nextRow = sheetData.Elements(SpreadsheetNamespace + "row")
            .FirstOrDefault(row => GetSpreadsheetRowIndex(row) > rowNumber);

        if (nextRow is null)
        {
            sheetData.Add(rowElement);
        }
        else
        {
            nextRow.AddBeforeSelf(rowElement);
        }

        return rowElement;
    }

    private static XElement GetOrCreateCellElement(
        XElement rowElement,
        string cellReference
    )
    {
        var cellElement = rowElement.Elements(SpreadsheetNamespace + "c")
            .FirstOrDefault(cell =>
                string.Equals(
                    cell.Attribute("r")?.Value,
                    cellReference,
                    StringComparison.OrdinalIgnoreCase
                )
            );

        if (cellElement is not null)
        {
            return cellElement;
        }

        cellElement = new XElement(
            SpreadsheetNamespace + "c",
            new XAttribute("r", cellReference)
        );
        var targetColumnIndex = GetColumnIndexFromReference(cellReference);
        var nextCell = rowElement.Elements(SpreadsheetNamespace + "c")
            .FirstOrDefault(cell =>
                GetColumnIndexFromReference(cell.Attribute("r")?.Value ?? "") >
                targetColumnIndex
            );

        if (nextCell is null)
        {
            rowElement.Add(cellElement);
        }
        else
        {
            nextCell.AddBeforeSelf(cellElement);
        }

        return cellElement;
    }

    private static string GetCellStringValue(
        XElement cellElement,
        SharedStringTable sharedStrings
    )
    {
        var cellType = cellElement.Attribute("t")?.Value;

        if (string.Equals(cellType, "s", StringComparison.OrdinalIgnoreCase))
        {
            var rawIndex = cellElement.Element(SpreadsheetNamespace + "v")?.Value;

            if (
                int.TryParse(rawIndex, out var sharedStringIndex) &&
                sharedStringIndex >= 0 &&
                sharedStringIndex < sharedStrings.Values.Count
            )
            {
                return sharedStrings.Values[sharedStringIndex];
            }

            return string.Empty;
        }

        if (string.Equals(cellType, "inlineStr", StringComparison.OrdinalIgnoreCase))
        {
            return string.Concat(
                cellElement
                    .Element(SpreadsheetNamespace + "is")?
                    .Descendants(SpreadsheetNamespace + "t")
                    .Select(textElement => textElement.Value) ?? []
            );
        }

        return cellElement.Element(SpreadsheetNamespace + "v")?.Value ?? string.Empty;
    }

    private static void SetCellStringValue(
        XElement cellElement,
        string value,
        SharedStringTable sharedStrings
    )
    {
        cellElement.Elements(SpreadsheetNamespace + "v").Remove();
        cellElement.Elements(SpreadsheetNamespace + "is").Remove();
        cellElement.Elements(SpreadsheetNamespace + "f").Remove();
        cellElement.Attribute("t")?.Remove();

        if (string.IsNullOrEmpty(value))
        {
            return;
        }

        if (sharedStrings.IsAvailable)
        {
            var sharedStringIndex = sharedStrings.GetOrAdd(value);
            cellElement.SetAttributeValue("t", "s");
            cellElement.Add(new XElement(SpreadsheetNamespace + "v", sharedStringIndex));
            return;
        }

        cellElement.SetAttributeValue("t", "inlineStr");
        cellElement.Add(new XElement(
            SpreadsheetNamespace + "is",
            new XElement(
                SpreadsheetNamespace + "t",
                new XAttribute(XNamespace.Xml + "space", "preserve"),
                value
            )
        ));
    }

    private static SharedStringTable LoadSharedStringTable(ZipArchive archive)
    {
        var entry = archive.GetEntry("xl/sharedStrings.xml");
        var table = new SharedStringTable
        {
            EntryName = entry?.FullName,
        };

        if (entry is null)
        {
            return table;
        }

        using (var stream = entry.Open())
        {
            table.Document = XDocument.Load(stream, LoadOptions.PreserveWhitespace);
        }

        foreach (var sharedString in table.Document.Root?.Elements(SpreadsheetNamespace + "si") ?? [])
        {
            var value = string.Concat(
                sharedString
                    .Descendants(SpreadsheetNamespace + "t")
                    .Select(textElement => textElement.Value)
            );
            table.IndexByValue.TryAdd(value, table.Values.Count);
            table.Values.Add(value);
        }

        return table;
    }

    private static void SaveSharedStringTable(
        ZipArchive archive,
        SharedStringTable sharedStrings
    )
    {
        if (!sharedStrings.IsAvailable || !sharedStrings.Changed)
        {
            return;
        }

        var entryName = sharedStrings.EntryName;

        if (string.IsNullOrWhiteSpace(entryName))
        {
            return;
        }

        var existingEntry = archive.GetEntry(entryName);
        existingEntry?.Delete();
        var nextEntry = archive.CreateEntry(entryName, CompressionLevel.Optimal);

        using var writeStream = nextEntry.Open();
        using var writer = new StreamWriter(writeStream, new UTF8Encoding(false));
        writer.Write(sharedStrings.Document!.ToString(SaveOptions.DisableFormatting));
    }

    private static string GetWorksheetEntryPath(ZipArchive archive, string? sheetName)
    {
        XNamespace workbookNamespace =
            "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
        XNamespace officeRelationshipNamespace =
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
        XNamespace packageRelationshipNamespace =
            "http://schemas.openxmlformats.org/package/2006/relationships";
        var workbookEntry = archive.GetEntry("xl/workbook.xml")
            ?? throw new InvalidOperationException("Workbook manifest not found.");
        var workbookRelationshipsEntry = archive.GetEntry("xl/_rels/workbook.xml.rels")
            ?? throw new InvalidOperationException("Workbook relationships not found.");
        XDocument workbookDocument;
        XDocument relationshipsDocument;

        using (var stream = workbookEntry.Open())
        {
            workbookDocument = XDocument.Load(stream);
        }

        using (var stream = workbookRelationshipsEntry.Open())
        {
            relationshipsDocument = XDocument.Load(stream);
        }

        var sheets = workbookDocument.Root?
            .Element(workbookNamespace + "sheets")?
            .Elements(workbookNamespace + "sheet")
            .ToList() ?? [];
        var sheet = !string.IsNullOrWhiteSpace(sheetName)
            ? sheets.FirstOrDefault(candidate =>
                string.Equals(
                    candidate.Attribute("name")?.Value,
                    sheetName,
                    StringComparison.OrdinalIgnoreCase
                )
            )
            : null;

        sheet ??= sheets.FirstOrDefault();

        if (sheet is null)
        {
            throw new InvalidOperationException("Worksheet not found.");
        }

        var relationshipId = sheet.Attribute(officeRelationshipNamespace + "id")?.Value
            ?? throw new InvalidOperationException("Worksheet relationship not found.");
        var relationship = relationshipsDocument.Root?
            .Elements(packageRelationshipNamespace + "Relationship")
            .FirstOrDefault(candidate =>
                string.Equals(
                    candidate.Attribute("Id")?.Value,
                    relationshipId,
                    StringComparison.OrdinalIgnoreCase
                )
            )
            ?? throw new InvalidOperationException("Worksheet relationship not found.");
        var target = relationship.Attribute("Target")?.Value
            ?? throw new InvalidOperationException("Worksheet target not found.");

        return NormalizeWorkbookZipPath(target);
    }

    private static string NormalizeWorkbookZipPath(string target)
    {
        var normalizedTarget = target.Replace('\\', '/');

        if (normalizedTarget.StartsWith('/'))
        {
            return normalizedTarget.TrimStart('/');
        }

        var parts = new List<string>();

        foreach (var part in ("xl/" + normalizedTarget).Split('/'))
        {
            if (string.IsNullOrWhiteSpace(part) || part == ".")
            {
                continue;
            }

            if (part == "..")
            {
                if (parts.Count > 0)
                {
                    parts.RemoveAt(parts.Count - 1);
                }

                continue;
            }

            parts.Add(part);
        }

        return string.Join('/', parts);
    }

    private static int GetSpreadsheetRowIndex(XElement rowElement)
    {
        return int.TryParse(rowElement.Attribute("r")?.Value, out var rowIndex)
            ? rowIndex
            : 0;
    }

    private static string GetCellReference(int zeroBasedRowIndex, int zeroBasedColumnIndex)
    {
        var columnNumber = zeroBasedColumnIndex + 1;
        var columnName = new StringBuilder();

        while (columnNumber > 0)
        {
            columnNumber -= 1;
            columnName.Insert(0, (char)('A' + columnNumber % 26));
            columnNumber /= 26;
        }

        return $"{columnName}{zeroBasedRowIndex + 1}";
    }

    private static int GetColumnIndexFromReference(string cellReference)
    {
        var columnIndex = 0;

        foreach (var character in cellReference)
        {
            if (!char.IsLetter(character))
            {
                break;
            }

            columnIndex = columnIndex * 26 + char.ToUpperInvariant(character) - 'A' + 1;
        }

        return columnIndex - 1;
    }

    private sealed class SharedStringTable
    {
        public string? EntryName { get; set; }
        public XDocument? Document { get; set; }
        public List<string> Values { get; } = [];
        public Dictionary<string, int> IndexByValue { get; } = new(StringComparer.Ordinal);
        public bool Changed { get; set; }
        public bool IsAvailable => Document?.Root is not null &&
            !string.IsNullOrWhiteSpace(EntryName);

        public int GetOrAdd(string value)
        {
            if (IndexByValue.TryGetValue(value, out var existingIndex))
            {
                return existingIndex;
            }

            var root = Document?.Root
                ?? throw new InvalidOperationException("Shared string table not loaded.");
            var index = Values.Count;
            var textElement = new XElement(SpreadsheetNamespace + "t", value);

            if (
                value.Length != value.Trim().Length ||
                value.Contains('\n') ||
                value.Contains('\r') ||
                value.Contains('\t')
            )
            {
                textElement.SetAttributeValue(XNamespace.Xml + "space", "preserve");
            }

            root.Add(new XElement(SpreadsheetNamespace + "si", textElement));
            Values.Add(value);
            IndexByValue[value] = index;
            root.SetAttributeValue("count", Values.Count);
            root.SetAttributeValue("uniqueCount", Values.Count);
            Changed = true;

            return index;
        }
    }
}
