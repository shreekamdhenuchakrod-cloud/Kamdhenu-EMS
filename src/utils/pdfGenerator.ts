import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';

interface PDFMeta {
  employeeId?: string;
  employeeName?: string;
  generatedBy: string;
  title: string;
}

export async function generateA4PDF(
  pages: HTMLElement[],
  filename: string,
  meta: PDFMeta
): Promise<boolean> {
  try {
    const pdf = new jsPDF('p', 'mm', 'a4');
    const totalPages = pages.length;

    // A4 dimensions in mm
    const a4W = 210;
    const a4H = 297;
    const margin = 8;
    const headerH = 8;   // space for header band
    const footerH = 10;  // space for footer band
    const contentY = margin + headerH + 1;
    const contentH = a4H - contentY - footerH - margin;
    const contentW = a4W - margin * 2;

    for (let i = 0; i < totalPages; i++) {
      const pageElement = pages[i];

      if (i > 0) pdf.addPage();

      // Temporarily force A4 width in pixels (794px @ 96DPI) to prevent mobile responsive squishing
      const originalWidth = pageElement.style.width;
      const originalMaxWidth = pageElement.style.maxWidth;
      pageElement.style.width = '794px';
      pageElement.style.maxWidth = '794px';

      // ---- Capture page as high-res canvas ----
      const canvas = await html2canvas(pageElement, {
        scale: 3,            // 3x = crisp on retina
        useCORS: true,
        allowTaint: false,
        backgroundColor: '#ffffff',
        logging: false,
        scrollX: 0,
        scrollY: -window.scrollY,
        windowWidth: 794,
      });

      // Restore original styles
      pageElement.style.width = originalWidth;
      pageElement.style.maxWidth = originalMaxWidth;

      const imgData = canvas.toDataURL('image/png');   // PNG – lossless, no JPEG blur

      // ---- Scale image to fit content area without stretching ----
      const canvasAspect = canvas.height / canvas.width;   // h/w ratio
      let destW = contentW;
      let destH = contentW * canvasAspect;

      // If image taller than available content area, scale down
      if (destH > contentH) {
        destH = contentH;
        destW = contentH / canvasAspect;
      }

      // Center horizontally
      const xOffset = margin + (contentW - destW) / 2;
      pdf.addImage(imgData, 'PNG', xOffset, contentY, destW, destH);

      // ---- HEADER BAND ----
      pdf.setFillColor(245, 247, 250);
      pdf.rect(0, 0, a4W, margin + headerH, 'F');
      pdf.setDrawColor(226, 232, 240);
      pdf.setLineWidth(0.2);
      pdf.line(margin, margin + headerH, a4W - margin, margin + headerH);

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7.5);
      pdf.setTextColor(71, 85, 105);
      pdf.text(meta.title, margin, margin + 5.5);

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(6.5);
      pdf.setTextColor(148, 163, 184);
      const now = new Date().toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
      pdf.text(`Generated: ${now}`, a4W - margin, margin + 5.5, { align: 'right' });

      // ---- FOOTER BAND ----
      const footerY = a4H - margin - footerH;
      pdf.setFillColor(245, 247, 250);
      pdf.rect(0, footerY, a4W, margin + footerH, 'F');
      pdf.line(margin, footerY, a4W - margin, footerY);

      pdf.setFontSize(6.5);
      pdf.setTextColor(148, 163, 184);
      pdf.text(`${meta.generatedBy}`, margin, footerY + 4.5);

      if (meta.employeeId) {
        pdf.text(`EMP: ${meta.employeeId}`, a4W / 2, footerY + 4.5, { align: 'center' });
      }

      pdf.text(`Page ${i + 1} / ${totalPages}`, a4W - margin, footerY + 4.5, { align: 'right' });

      // Mini QR placeholder box
      const qrSz = 5.5;
      const qrX  = a4W - margin - qrSz - 18;
      const qrY  = footerY + 2;
      pdf.setDrawColor(100, 116, 139);
      pdf.setLineWidth(0.3);
      pdf.rect(qrX, qrY, qrSz, qrSz);
      pdf.setFontSize(4);
      pdf.setTextColor(100, 116, 139);
      pdf.text('QR', qrX + 1, qrY + 3.5);
    }

    pdf.save(filename);
    return true;
  } catch (error) {
    console.error('generateA4PDF Failed:', error);
    alert('PDF generation error: ' + error);
    return false;
  }
}
